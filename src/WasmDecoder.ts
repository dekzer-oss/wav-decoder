import createWavDecoderModule, { type WasmDecoderModule } from '@/wasm/build/decoder';
import type { DecodedWavAudio, DecodeError, WavAudioDecoder, WavDecoderInfo } from './index';
import { DecoderState, type WavFormat } from './index';
import { RingBuffer } from './RingBuffer';

// --- Constants ---
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_ALAW = 6;
const WAVE_FORMAT_ULAW = 7;
const WAVE_FORMAT_IMA_ADPCM = 17;

const C_HEADER_STRUCT_SIZE = 24;
const MIN_BUFFER_FOR_HEADER = 44; // Kept for an initial check, but logic is more robust now
const INITIAL_BUFFER_SIZE = 8192;

const MAX_BATCH_SIZE = 65536;
const DEFAULT_BATCH_SIZE =
  typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 4) > 4 ? 16384 : 4096;

// --- Types ---
type DecoderFunctionMono = (inputPtr: number, outputPtr: number, blockCount: number) => void;
type DecoderFunctionStereo = (
  inputPtr: number,
  leftPtr: number,
  rightPtr: number,
  blockCount: number,
) => void;
type DecoderFunction = DecoderFunctionMono | DecoderFunctionStereo;

// --- Maps ---
const DECODER_FUNCTION_MAP = new Map<string, string>([
  ['pcm_8_mono', '_decode_pcm8_mono'],
  ['pcm_8_stereo', '_decode_pcm8_stereo'],
  ['pcm_16_mono', '_decode_pcm16_mono'],
  ['pcm_16_stereo', '_decode_pcm16_stereo'],
  ['pcm_24_mono', '_decode_pcm24_mono'],
  ['pcm_24_stereo', '_decode_pcm24_stereo'],
  ['pcm_32_mono', '_decode_pcm32_mono'],
  ['pcm_32_stereo', '_decode_pcm32_stereo'],
  ['float_32_mono', '_decode_float32_mono'],
  ['float_32_stereo', '_decode_float32_stereo'],
  ['float_64_mono', '_decode_float64_mono'],
  ['float_64_stereo', '_decode_float64_stereo'],
  ['alaw_mono', '_decode_alaw_mono'],
  ['alaw_stereo', '_decode_alaw_stereo'],
  ['ulaw_mono', '_decode_ulaw_mono'],
  ['ulaw_stereo', '_decode_ulaw_stereo'],
  ['ima_adpcm_mono', '_decode_ima_adpcm_mono'],
  ['ima_adpcm_stereo', '_decode_ima_adpcm_stereo'],
]);

// --- Helper Functions ---

/**
 * Scans a WAV file buffer to find the start offset of the 'data' chunk payload.
 * This is crucial for parsing headers with variable-sized metadata chunks.
 */
function findDataChunkOffset(src: Uint8Array): number {
  if (src.byteLength < 20) return 0;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);

  // Check for 'RIFF' and 'WAVE' identifiers
  const id0 = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  const id8 = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (id0 !== 'RIFF' || id8 !== 'WAVE') return 0;

  let off = 12; // Start after 'WAVE'
  while (off + 8 <= src.byteLength) {
    const cid = String.fromCharCode(
      dv.getUint8(off + 0),
      dv.getUint8(off + 1),
      dv.getUint8(off + 2),
      dv.getUint8(off + 3),
    );
    const size = dv.getUint32(off + 4, true);
    const chunkStart = off + 8;
    const next = chunkStart + size + (size & 1); // Word align for next chunk

    if (cid === 'data') return chunkStart; // Found it, return offset of payload

    if (next > src.byteLength) return 0; // Not enough data to read next chunk
    off = next;
  }
  return 0; // 'data' chunk not found
}

/**
 * Calculates the number of PCM samples per block for IMA ADPCM.
 */
function imaSamplesPerBlock(blockAlign: number, channels: number): number {
  if (blockAlign <= 0 || channels <= 0) return 0;
  // IMA ADPCM formula (per channel), accounting for header bytes in the block
  return (blockAlign - 4 * channels) * 2 + 1;
}

// --- Helper Classes ---

/**
 * Pools Float32Array instances by size to reduce GC churn.
 */
class Float32ArrayPool {
  private pools: Map<number, Float32Array[]> = new Map();
  private readonly maxPoolSize = 16;

  public get(size: number): Float32Array {
    const pool = this.pools.get(size);
    if (pool && pool.length) return pool.pop()!;
    return new Float32Array(size);
  }

  public release(array: Float32Array): void {
    const size = array.length;
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }
    if (pool.length < this.maxPoolSize) pool.push(array);
  }

  public clear(): void {
    this.pools.clear();
  }
}

/**
 * Manages WASM heap allocations with small pointer pools for reuse.
 */
class WasmMemoryManager {
  private wasm: WasmDecoderModule;
  private allocatedPtrs: Set<number> = new Set();
  private memoryPools: Map<number, number[]> = new Map();
  private readonly maxPoolSize = 8;

  constructor(wasm: WasmDecoderModule) {
    this.wasm = wasm;
  }

  public malloc(size: number): number {
    if (size <= 0) throw new Error(`Invalid allocation size: ${size}`);
    const pool = this.memoryPools.get(size);
    if (pool && pool.length) {
      const ptr = pool.pop()!;
      this.allocatedPtrs.add(ptr);
      return ptr;
    }
    const ptr = this.wasm._malloc(size);
    if (ptr === 0) throw new Error(`Memory allocation failed for ${size} bytes`);
    this.allocatedPtrs.add(ptr);
    return ptr;
  }

  public free(ptr: number): void {
    if (ptr === 0) return;
    if (!this.allocatedPtrs.has(ptr)) {
      for (const [, pool] of this.memoryPools) {
        if (pool.includes(ptr)) {
          console.warn(`Attempting to free pooled pointer: ${ptr} — ignored`);
          return;
        }
      }
      console.warn(`Attempting to free untracked pointer: ${ptr} — ignored`);
      return;
    }
    this.wasm._free(ptr);
    this.allocatedPtrs.delete(ptr);
  }

  public poolFree(ptr: number, size: number): void {
    if (ptr === 0) return;
    if (!this.allocatedPtrs.has(ptr)) return;
    this.allocatedPtrs.delete(ptr);

    let pool = this.memoryPools.get(size);
    if (!pool) {
      pool = [];
      this.memoryPools.set(size, pool);
    }
    if (pool.length < this.maxPoolSize) {
      pool.push(ptr);
    } else {
      this.wasm._free(ptr);
    }
  }

  public freeAll(): void {
    for (const pool of this.memoryPools.values()) {
      for (const ptr of pool) this.wasm._free(ptr);
    }
    this.memoryPools.clear();

    for (const ptr of this.allocatedPtrs) this.wasm._free(ptr);
    this.allocatedPtrs.clear();
  }

  public safeGetValue = (ptr: number, type: string, offset = 0): number =>
    this.wasm.getValue(ptr + offset, type);

  public safeSetMemory = (ptr: number, data: Uint8Array): void => {
    this.wasm.HEAPU8.set(data, ptr);
  };
}
// Enhanced header parsing constants
const MIN_RIFF_HEADER = 12; // RIFF + size + WAVE
const MIN_CHUNK_HEADER = 8; // chunk ID + size
const MAX_HEADER_SIZE = 64 * 1024; // 64KB max header size (reasonable limit)
const INITIAL_PEEK_SIZE = 1024; // Start with smaller peek size

/**
 * Enhanced function to find data chunk with better streaming support
 */
function findDataChunkOffsetStreaming(src: Uint8Array): {
  dataOffset: number;
  dataSize: number; // <— NEW
  riffTotalSize: number; // <— NEW (RIFF size + 8)
  needMoreData: boolean;
  headerComplete: boolean;
  minBytesNeeded: number;
} {
  const result = {
    dataOffset: 0,
    dataSize: 0,
    riffTotalSize: 0,
    needMoreData: false,
    headerComplete: false,
    minBytesNeeded: MIN_RIFF_HEADER,
  };

  if (src.byteLength < MIN_RIFF_HEADER) {
    result.needMoreData = true;
    return result;
  }

  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const riffId = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3),
  );
  const waveId = String.fromCharCode(
    dv.getUint8(8),
    dv.getUint8(9),
    dv.getUint8(10),
    dv.getUint8(11),
  );
  if (riffId !== 'RIFF' || waveId !== 'WAVE') {
    throw new Error('Invalid WAV file: Missing RIFF/WAVE headers');
  }

  const fileSize = dv.getUint32(4, true);
  if (fileSize < 4 || fileSize > 0x7fffffff) {
    throw new Error(`Invalid WAV file: Unreasonable file size ${fileSize}`);
  }
  const expectedTotalSize = fileSize + 8;
  result.riffTotalSize = expectedTotalSize; // <— record

  let offset = MIN_RIFF_HEADER;
  let chunksProcessed = 0;
  const maxChunks = 100;

  while (offset < src.byteLength && chunksProcessed < maxChunks) {
    if (offset + MIN_CHUNK_HEADER > src.byteLength) {
      result.needMoreData = true;
      result.minBytesNeeded = offset + MIN_CHUNK_HEADER;
      return result;
    }

    const chunkId = String.fromCharCode(
      dv.getUint8(offset + 0),
      dv.getUint8(offset + 1),
      dv.getUint8(offset + 2),
      dv.getUint8(offset + 3),
    );
    const chunkSize = dv.getUint32(offset + 4, true);
    const chunkDataStart = offset + MIN_CHUNK_HEADER;
    const chunkDataEnd = chunkDataStart + chunkSize;
    const nextChunkOffset = chunkDataEnd + (chunkSize & 1);

    if (chunkId === 'data') {
      result.dataOffset = chunkDataStart;
      result.dataSize = chunkSize; // <— record
      result.headerComplete = true;
      return result;
    }

    if (chunkSize < 0 || chunkSize > MAX_HEADER_SIZE) {
      throw new Error(`Invalid chunk size for '${chunkId}': ${chunkSize}`);
    }
    if (chunkDataEnd > src.byteLength) {
      if (chunkSize > MAX_HEADER_SIZE) {
        throw new Error(`Header chunk '${chunkId}' too large: ${chunkSize} bytes`);
      }
      result.needMoreData = true;
      result.minBytesNeeded = Math.min(chunkDataEnd, offset + MAX_HEADER_SIZE);
      return result;
    }
    if (nextChunkOffset <= offset) {
      throw new Error(`Malformed WAV file: Invalid chunk progression at offset ${offset}`);
    }
    if (nextChunkOffset > MAX_HEADER_SIZE) {
      throw new Error(`WAV header too large: exceeds ${MAX_HEADER_SIZE} bytes`);
    }

    offset = nextChunkOffset;
    chunksProcessed++;
  }

  if (chunksProcessed >= maxChunks) {
    throw new Error('WAV file has too many chunks (possible corruption)');
  }

  result.needMoreData = true;
  result.minBytesNeeded = Math.min(offset + MIN_CHUNK_HEADER, MAX_HEADER_SIZE);
  return result;
}
export class WasmDecoder implements WavAudioDecoder {
  private wasm!: WasmDecoderModule;
  private _info: WavDecoderInfo;
  private buffer: RingBuffer;
  private memoryManager!: WasmMemoryManager;
  private arrayPool!: Float32ArrayPool;

  private _decoderFn: DecoderFunction | null = null;
  private _isMono = false;
  private _isReady = false;

  private _inputPtr = 0;
  private _inputSize = 0;
  private _outputPtrs: number[] = [];
  private _outputSamples = 0;

  private _formatKey = '';
  private _maxSamplesPerBatch = DEFAULT_BATCH_SIZE;

  // --- NEW: tracking fields for accurate progress ---
  private _dataBytesTotal = 0; // size of 'data' payload in bytes
  private _riffTotalSize = 0; // RIFF reported total (size + 8)
  private _headerBytes = 0; // bytes before data payload (offset to 'data')
  private _totalSamplesPerChannel = 0; // expected total samples per channel

  public readonly ready: Promise<boolean>;

  constructor() {
    this.buffer = new RingBuffer(INITIAL_BUFFER_SIZE);
    this._info = this.createDefaultInfo();

    this.ready = (async () => {
      this.wasm = await createWavDecoderModule();
      this.memoryManager = new WasmMemoryManager(this.wasm);
      this.arrayPool = new Float32ArrayPool();
      this._isReady = true;
      return true;
    })();
  }

  public static async create(): Promise<WasmDecoder> {
    const d = new WasmDecoder();
    await d.ready;
    return d;
  }

  private assertReady(): void {
    if (!this._isReady) {
      throw new Error('WasmDecoder not ready yet. Call `await decoder.ready` before using it.');
    }
  }

  public get info(): WavDecoderInfo {
    return this._info;
  }

  public setBatchSize(samples: number): void {
    this._maxSamplesPerBatch = Math.max(1, Math.min(samples | 0, MAX_BATCH_SIZE));
  }

  private get hasParsedHeader(): boolean {
    return this._info.state !== DecoderState.IDLE;
  }

  public get state(): DecoderState {
    return this._info.state;
  }

  get format(): WavFormat {
    return this._info.format;
  }

  // --- Streaming header parser that also sets totals ---
  private tryParseHeaderStreaming(): DecodedWavAudio {
    this.assertReady();

    if (this.buffer.available < MIN_RIFF_HEADER) {
      return this.createEmptyDecodedAudio();
    }

    try {
      let peekSize = Math.min(this.buffer.available, INITIAL_PEEK_SIZE);
      let parseResult: ReturnType<typeof findDataChunkOffsetStreaming>;

      do {
        const peek = this.buffer.peekCopy(peekSize);
        if (!peek) return this.createEmptyDecodedAudio();

        parseResult = findDataChunkOffsetStreaming(peek);

        if (parseResult.headerComplete) break;

        if (!parseResult.needMoreData) {
          throw new Error('WAV file does not contain a data chunk');
        }
        if (parseResult.minBytesNeeded > this.buffer.available) {
          return this.createEmptyDecodedAudio();
        }
        if (parseResult.minBytesNeeded > MAX_HEADER_SIZE) {
          throw new Error(
            `WAV header too large: ${parseResult.minBytesNeeded} bytes (max: ${MAX_HEADER_SIZE})`,
          );
        }

        peekSize = Math.min(parseResult.minBytesNeeded, this.buffer.available, MAX_HEADER_SIZE);
      } while (peekSize <= this.buffer.available);

      if (!parseResult.headerComplete) {
        return this.createEmptyDecodedAudio();
      }

      // Record sizes
      this._riffTotalSize = parseResult.riffTotalSize | 0;
      this._dataBytesTotal = parseResult.dataSize | 0;
      this._headerBytes = parseResult.dataOffset | 0;

      const headerBytes = this.buffer.peekCopy(parseResult.dataOffset);
      if (!headerBytes) throw new Error('Failed to read header bytes');

      let headerPtr = 0;
      let tempFilePtr = 0;
      try {
        headerPtr = this.memoryManager.malloc(C_HEADER_STRUCT_SIZE);
        tempFilePtr = this.memoryManager.malloc(headerBytes.length);
        this.memoryManager.safeSetMemory(tempFilePtr, headerBytes);

        const parseSuccess = this.wasm._parse_header(tempFilePtr, headerBytes.length, headerPtr);
        if (!parseSuccess) {
          throw new Error('WASM header parsing failed - invalid or unsupported WAV format');
        }

        this._info.state = DecoderState.DECODING;
        this.populateFormatFromHeaderOptimized(headerPtr);

        // Compute totals now that format is known
        const { blockAlign, sampleRate, channels, formatTag, samplesPerBlock } = this._info.format;

        let totalFrames: number;
        if (formatTag === WAVE_FORMAT_IMA_ADPCM) {
          const spb =
            samplesPerBlock > 0 ? samplesPerBlock : imaSamplesPerBlock(blockAlign, channels);
          const blocks = Math.floor(this._dataBytesTotal / blockAlign);
          totalFrames = blocks * spb;
        } else {
          totalFrames = Math.floor(this._dataBytesTotal / blockAlign);
        }

        this._totalSamplesPerChannel = totalFrames | 0;

        // Fill public info
        this._info.totalBytes = this._riffTotalSize || 0;
        this._info.totalDuration = sampleRate > 0 ? this._totalSamplesPerChannel / sampleRate : 0;
        this._info.remainingBytes = this._dataBytesTotal;
        this._info.progress = this._dataBytesTotal > 0 ? 0 : 0;

        // Discard header so only audio data remains
        this.buffer.discard(parseResult.dataOffset);

        return this.processAudioBufferOptimized();
      } finally {
        if (headerPtr) this.memoryManager.free(headerPtr);
        if (tempFilePtr) this.memoryManager.free(tempFilePtr);
      }
    } catch (error) {
      console.error('[WasmDecoder] streaming header parse error:', error);
      this.resetAndSetError(`Header parsing failed: ${(error as Error).message}`);
      return this.createEmptyDecodedAudio(this._info.errors);
    }
  }

  /**
   * Main decode entry. Writes chunk into the ring buffer, parses header when needed,
   * and decodes available frames in bounded batches.
   */
  public decode(chunk: Uint8Array): DecodedWavAudio {
    this.assertReady();

    const state = this._info.state;
    if (state === DecoderState.ENDED) {
      return this.createEmptyDecodedAudio();
    }
    if (state !== DecoderState.IDLE && state !== DecoderState.DECODING) {
      throw new Error(`Invalid decoder state: ${DecoderState[state]}`);
    }
    if (!chunk || chunk.length === 0) {
      return this.createEmptyDecodedAudio();
    }

    try {
      this.buffer.write(chunk);

      if (!this.hasParsedHeader) {
        return this.tryParseHeaderStreaming();
      }

      return this.processAudioBufferOptimized();
    } catch (error) {
      console.error('[WasmDecoder] decode error:', error);
      this.resetAndSetError((error as Error).message ?? String(error));
      return this.createEmptyDecodedAudio(this._info.errors);
    }
  }

  public flush(): DecodedWavAudio {
    this.assertReady();

    const state = this._info.state;
    if (state !== DecoderState.DECODING && state !== DecoderState.ENDED) {
      throw new Error(`Invalid decoder state for flush: ${DecoderState[state]}`);
    }
    if (this.state === DecoderState.ENDED) {
      return this.createEmptyDecodedAudio();
    }

    try {
      const result = this.processAudioBufferOptimized();

      // Ensure final progress reflects completion when totals are known
      if (this._dataBytesTotal > 0) {
        this._info.remainingBytes = Math.max(0, this._dataBytesTotal - this._info.decodedBytes);
        this._info.progress =
          this._info.remainingBytes === 0
            ? 1
            : Math.min(1, this._info.decodedBytes / this._dataBytesTotal);
      }

      this._info.state = DecoderState.ENDED;
      return result;
    } catch (error) {
      console.error('[WasmDecoder] flush error:', error);
      this.resetAndSetError((error as Error).message);
      return this.createEmptyDecodedAudio(this._info.errors);
    }
  }

  public reset(): void {
    this.buffer.clear();

    if (this._isReady) {
      if (this._inputPtr !== 0) {
        this.memoryManager.poolFree(this._inputPtr, this._inputSize);
        this._inputPtr = 0;
        this._inputSize = 0;
      }

      for (let i = 0; i < this._outputPtrs.length; i++) {
        this.memoryManager.poolFree(this._outputPtrs[i], this._outputSamples * 4);
      }
    }

    this._outputPtrs.length = 0;
    this._outputSamples = 0;
    this._decoderFn = null;
    this._isMono = false;
    this._formatKey = '';

    // Clear new trackers
    this._dataBytesTotal = 0;
    this._riffTotalSize = 0;
    this._headerBytes = 0;
    this._totalSamplesPerChannel = 0;

    this._info = this.createDefaultInfo();
  }

  public free(): void {
    if (this._isReady) {
      this.reset();
      this.memoryManager.freeAll();
      this.arrayPool.clear();
    } else {
      this.reset();
    }
  }

  // Retained for non-streaming use cases (kept functional)
  private tryParseHeader(): DecodedWavAudio {
    this.assertReady();

    if (this.buffer.available < MIN_BUFFER_FOR_HEADER) {
      return this.createEmptyDecodedAudio();
    }

    const cap = Math.min(this.buffer.available, 1024 * 1024);
    const peek = this.buffer.peekCopy(cap);
    if (!peek) return this.createEmptyDecodedAudio();

    let dataOffset = findDataChunkOffset(peek);
    if (dataOffset === 0) {
      return this.createEmptyDecodedAudio();
    }

    if (dataOffset > this.buffer.available) {
      return this.createEmptyDecodedAudio();
    }

    const headerBytes = peek.subarray(0, dataOffset);

    let headerPtr = 0;
    let tempFilePtr = 0;
    try {
      headerPtr = this.memoryManager.malloc(C_HEADER_STRUCT_SIZE);
      tempFilePtr = this.memoryManager.malloc(headerBytes.length);
      this.memoryManager.safeSetMemory(tempFilePtr, headerBytes);

      const ok = this.wasm._parse_header(tempFilePtr, headerBytes.length, headerPtr);
      if (!ok) {
        throw new Error('Failed to parse WAV header from the provided data.');
      }

      this._info.state = DecoderState.DECODING;
      this.populateFormatFromHeaderOptimized(headerPtr);

      // We only know header offset here; compute totals approximately if possible
      this._headerBytes = dataOffset;
      this._dataBytesTotal = 0; // unknown in this non-streaming path

      this.buffer.discard(dataOffset);

      return this.processAudioBufferOptimized();
    } catch (e) {
      console.error('[WasmDecoder] header parse error:', e);
      this.resetAndSetError((e as Error).message);
      return this.createEmptyDecodedAudio(this._info.errors);
    } finally {
      if (headerPtr) this.memoryManager.free(headerPtr);
      if (tempFilePtr) this.memoryManager.free(tempFilePtr);
    }
  }

  private processAudioBufferOptimized(): DecodedWavAudio {
    this.assertReady();

    const { blockAlign, channels, formatTag, samplesPerBlock } = this._info.format;
    if (!blockAlign || !channels || this.buffer.available < blockAlign || !this._decoderFn) {
      return this.createEmptyDecodedAudio();
    }

    const maxBytesForBatch = this._maxSamplesPerBatch * blockAlign;
    const availableBytes = Math.floor(this.buffer.available / blockAlign) * blockAlign;
    const bytesToProcess = Math.min(availableBytes, maxBytesForBatch);
    if (bytesToProcess === 0) {
      return this.createEmptyDecodedAudio();
    }

    const blocksToProcess = bytesToProcess / blockAlign;
    const dataToProcess = this.buffer.read(bytesToProcess);
    if (!dataToProcess) return this.createEmptyDecodedAudio();

    let pcmSamplesPerChan = blocksToProcess; // default for PCM-like
    if (formatTag === WAVE_FORMAT_IMA_ADPCM) {
      const spb = samplesPerBlock > 0 ? samplesPerBlock : imaSamplesPerBlock(blockAlign, channels);
      pcmSamplesPerChan = blocksToProcess * spb;
    }

    this.ensureBufferCapacity(bytesToProcess, pcmSamplesPerChan, channels);
    this.memoryManager.safeSetMemory(this._inputPtr, dataToProcess);

    if (this._isMono) {
      (this._decoderFn as DecoderFunctionMono)(
        this._inputPtr,
        this._outputPtrs[0],
        blocksToProcess,
      );
    } else {
      (this._decoderFn as DecoderFunctionStereo)(
        this._inputPtr,
        this._outputPtrs[0],
        this._outputPtrs[1],
        blocksToProcess,
      );
    }

    const channelData: Float32Array[] = [];
    for (let i = 0; i < channels; i++) {
      const wasmView = new Float32Array(
        this.wasm.HEAPF32.buffer,
        this._outputPtrs[i],
        pcmSamplesPerChan,
      );
      const out = this.arrayPool.get(pcmSamplesPerChan);
      out.set(wasmView);
      channelData.push(out);
    }

    // Update counters & progress
    this._info.decodedBytes += bytesToProcess;

    if (this._dataBytesTotal > 0) {
      const remaining = Math.max(0, this._dataBytesTotal - this._info.decodedBytes);
      this._info.remainingBytes = remaining;
      this._info.progress = Math.min(1, this._info.decodedBytes / this._dataBytesTotal);
    } else if (this._riffTotalSize > 0) {
      const approx = Math.min(this._riffTotalSize, this._headerBytes + this._info.decodedBytes);
      this._info.progress = Math.min(1, approx / this._riffTotalSize);
      this._info.remainingBytes = Math.max(0, this._riffTotalSize - approx);
    } else {
      this._info.progress = 0;
      this._info.remainingBytes = 0;
    }

    return {
      ...this.createEmptyDecodedAudio(this._info.errors),
      channelData,
      samplesDecoded: pcmSamplesPerChan,
    };
  }

  private ensureBufferCapacity(
    bytesToProcess: number,
    samplesToDecode: number,
    channels: number,
  ): void {
    this.assertReady();

    if (bytesToProcess > this._inputSize) {
      if (this._inputPtr !== 0) {
        this.memoryManager.poolFree(this._inputPtr, this._inputSize);
      }
      this._inputPtr = this.memoryManager.malloc(bytesToProcess);
      this._inputSize = bytesToProcess;
    }

    if (samplesToDecode > this._outputSamples) {
      for (let i = 0; i < this._outputPtrs.length; i++) {
        this.memoryManager.poolFree(this._outputPtrs[i], this._outputSamples * 4);
      }

      this._outputPtrs.length = 0;
      const bufferSize = samplesToDecode * 4;
      for (let i = 0; i < channels; i++) {
        this._outputPtrs.push(this.memoryManager.malloc(bufferSize));
      }
      this._outputSamples = samplesToDecode;
    }
  }

  private populateFormatFromHeaderOptimized(headerPtr: number): void {
    this.assertReady();

    const getValue = this.memoryManager.safeGetValue;
    const tag = getValue(headerPtr, 'i16', 0);
    const channels = getValue(headerPtr, 'i16', 2);
    const blockAlign = getValue(headerPtr, 'i16', 12);

    let samplesPerBlock = 0;
    if (tag === WAVE_FORMAT_IMA_ADPCM) {
      samplesPerBlock = getValue(headerPtr, 'i32', 16) | 0;
    }

    const format: WavFormat = {
      formatTag: tag,
      channels: channels,
      sampleRate: getValue(headerPtr, 'i32', 4),
      bytesPerSecond: getValue(headerPtr, 'i32', 8),
      blockAlign: blockAlign,
      bitDepth: getValue(headerPtr, 'i16', 14),
      samplesPerBlock,
    };

    if (
      format.channels <= 0 ||
      format.channels > 2 ||
      format.sampleRate <= 0 ||
      format.blockAlign <= 0
    ) {
      throw new Error(
        `Invalid WAV format: channels=${format.channels}, sampleRate=${format.sampleRate}, blockAlign=${format.blockAlign}`,
      );
    }

    this._info.format = format;
    this._isMono = format.channels === 1;

    this._formatKey = this.getDecoderFunctionKey(format);
    const fnName = DECODER_FUNCTION_MAP.get(this._formatKey);
    if (!fnName) {
      throw new Error(`Unsupported audio format: ${this._formatKey}`);
    }

    const decoder = (this.wasm as any)[fnName];
    if (typeof decoder !== 'function') {
      throw new Error(
        `Decoder function not found: ${fnName}. Ensure it is exported from the WASM module.`,
      );
    }
    this._decoderFn = decoder as DecoderFunction;
  }

  private getDecoderFunctionKey(format: WavFormat): string {
    const { formatTag, channels, bitDepth } = format;
    const channelStr = channels === 1 ? 'mono' : 'stereo';

    switch (formatTag) {
      case WAVE_FORMAT_PCM:
        return `pcm_${bitDepth}_${channelStr}`;
      case WAVE_FORMAT_IEEE_FLOAT:
        return `float_${bitDepth}_${channelStr}`;
      case WAVE_FORMAT_ALAW:
        return `alaw_${channelStr}`;
      case WAVE_FORMAT_ULAW:
        return `ulaw_${channelStr}`;
      case WAVE_FORMAT_IMA_ADPCM:
        return `ima_adpcm_${channelStr}`;
      case 0xfffe: // WAVE_FORMAT_EXTENSIBLE
        console.warn(
          'Extensible WAV format detected. Attempting to parse with bit depth and channel count.',
        );
        if (bitDepth === 8) return `pcm_8_${channelStr}`;
        if (bitDepth === 16) return `pcm_16_${channelStr}`;
        if (bitDepth === 24) return `pcm_24_${channelStr}`;
        if (bitDepth === 32) return `pcm_32_${channelStr}`;
        if (bitDepth === 32 && formatTag === WAVE_FORMAT_IEEE_FLOAT)
          return `float_32_${channelStr}`;
        if (bitDepth === 64 && formatTag === WAVE_FORMAT_IEEE_FLOAT)
          return `float_64_${channelStr}`;
        throw new Error(`Unsupported extensible WAV format with bit depth ${bitDepth}`);
      default:
        throw new Error(`Unsupported WAV format tag: ${formatTag}`);
    }
  }

  private resetAndSetError(message: string): void {
    this.reset();
    this._info.state = DecoderState.ERROR;
    this._info.errors.push({
      message,
      frameNumber: 0,
      frameLength: 0,
      inputBytes: 0,
      outputSamples: 0,
    });
  }

  private createEmptyDecodedAudio = (errors: DecodeError[] = []): DecodedWavAudio => ({
    bitDepth: this._info.format.bitDepth,
    channelData: [],
    errors,
    sampleRate: this._info.format.sampleRate,
    samplesDecoded: 0,
  });

  private createDefaultInfo(): WavDecoderInfo {
    return {
      decodedBytes: 0,
      errors: [],
      format: {
        bitDepth: 0,
        blockAlign: 0,
        bytesPerSecond: 0,
        channels: 0,
        samplesPerBlock: 0,
        formatTag: 0,
        sampleRate: 0,
        channelMask: undefined,
        extensionSize: undefined,
        subFormat: undefined,
        validBitsPerSample: undefined,
      },
      parsedChunks: [],
      progress: 0,
      remainingBytes: 0,
      state: DecoderState.IDLE,
      totalBytes: 0,
      totalDuration: 0,
      unhandledChunks: [],
    };
  }
}
