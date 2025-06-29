import type { DecodeError, DecodedWaveAudio, WaveFormat } from './types';
import { RingBuffer } from './RingBuffer.ts';

export enum DecoderState {
  UNINIT,
  DECODING,
  ENDED,
  ERROR,
}

/** @internal
 * Represents a generic chunk in the WAV container format.
 * Used for bookkeeping during progressive parsing.
 */
interface ChunkInfo {
  /** The FourCC chunk ID, e.g. 'fmt ', 'data', 'LIST'. */
  id: string;

  /** Size of the chunk's payload in bytes (not including header). */
  size: number;

  /** Absolute byte offset where this chunk begins in the file. */
  offset: number;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

const KSDATAFORMAT_SUBTYPE_PCM = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Uint8Array([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export interface DecoderOptions {
  /**
   * Maximum size of the decoded audio buffer (in bytes).
   * Controls how much audio is buffered internally before consumption.
   * Default: 16_777_216 (16 MiB)
   */
  maxBufferSize?: number;
}

/**
 * A robust, dependency-free, streaming WAV audio decoder for JavaScript.
 * It supports PCM (8, 16, 24, 32-bit), IEEE Float (32, 64-bit), A-Law, and µ-Law formats.
 * It is designed to be highly resilient to malformed files and can be used in any JavaScript environment.
 */
export class WaveDecoder {
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;
  private static readonly MAX_CHANNELS = 32;
  private static readonly ALAW_TABLE: Float32Array = WaveDecoder.buildAlawTable();
  private static readonly MULAW_TABLE: Float32Array = WaveDecoder.buildMulawTable();
  private readonly errors: DecodeError[] = [];

  private state = DecoderState.UNINIT;
  private ringBuffer: RingBuffer;
  private format = {} as WaveFormat;
  private parsedChunks: ChunkInfo[] = [];
  private unhandledChunks: ChunkInfo[] = [];
  private factChunkSamples = 0;
  private remainingBytes = 0;
  private totalBytes = 0;
  private decodedBytes = 0;
  private formatTag = 0;
  private isLittleEndian = true;
  private headerBuffer = new Uint8Array(0);

  // Reusable for PCM16 decode
  // private decodeView: DataView = new DataView(new ArrayBuffer(0));
  // private pcm16Out: Float32Array[] = [];
  // private pcm16Channels = 0;

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WaveDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);
  }

  /**
   * Provides current decoder state, format, statistics, and error history.
   * Useful for diagnostics, UI feedback, or debugging.
   */
  public get info() {
    return {
      state: this.state,
      format: { ...this.format },
      errors: [...this.errors],
      formatTag: this.formatTag,
      decodedBytes: this.decodedBytes,
      remainingBytes: this.remainingBytes,
      totalBytes: this.totalBytes,
      progress: this.totalBytes > 0 ? (this.totalBytes - this.remainingBytes) / this.totalBytes : 0,
      parsedChunks: [...this.parsedChunks],
      unhandledChunks: [...this.unhandledChunks],
    };
  }

  /**
   * Estimates the total number of audio samplesDecoded based on known data.
   * Relies on the 'fact' chunk or derives it from byte size and block alignment.
   */
  public get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockAlign > 0) {
      return Math.floor(this.totalBytes / this.format.blockAlign);
    }
    return 0;
  }

  private static buildMulawTable(): Float32Array {
    const MULAW_BIAS = 0x84;
    const table = new Float32Array(256);

    for (let i = 0; i < 256; i++) {
      let muVal = ~i & 0xff;
      let sign = muVal & 0x80 ? -1 : 1;
      let exponent = (muVal & 0x70) >> 4;
      let mantissa = muVal & 0x0f;

      let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
      sample -= MULAW_BIAS;

      table[i] = (sign * sample) / 32768;
    }
    return table;
  }

  private static buildAlawTable(): Float32Array {
    const table = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let aVal = i ^ 0x55;
      let sign = aVal & 0x80 ? -1 : 1;
      let exponent = (aVal & 0x70) >> 4;
      let mantissa = aVal & 0x0f;

      let sample: number;
      if (exponent === 0) {
        sample = (mantissa << 4) + 8;
      } else {
        sample = ((mantissa + 16) << (exponent + 3)) - 2048;
      }

      table[i] = (sign * sample) / 32768;
    }
    return table;
  }

  /**
   * Frees internal resources and marks the decoder as ended.
   * This should be called once decoding is finished or no longer needed.
   */
  public free(): void {
    this.reset();
    this.state = DecoderState.ENDED;
  }

  /**
   * Resets the decoder to its uninitialized state.
   * Clears all internal buffers, errors, format state, and progress tracking.
   * Useful for reusing the decoder instance.
   */
  public reset(): void {
    this.state = DecoderState.UNINIT;
    this.ringBuffer.clear();
    this.errors.length = 0;
    this.format = {} as WaveFormat;
    this.remainingBytes = this.decodedBytes = this.totalBytes = this.factChunkSamples = 0;
    this.parsedChunks = [];
    this.unhandledChunks = [];
    this.formatTag = 0;
    this.isLittleEndian = true;
    this.headerBuffer = new Uint8Array(0);
  }

  /**
   * Decodes a new chunk of audio data. Accepts raw WAV bytes progressively.
   * This method can be called with partial or full WAV chunks.
   *
   * @param chunk - A byte chunk of the WAV file.
   * @returns Decoded audio data or an error result.
   */
  public decode(chunk: Uint8Array): DecodedWaveAudio {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createErrorResult('Decoder is in a terminal state.');
    }

    try {
      if (this.state === DecoderState.UNINIT) {
        if (this.headerBuffer.length + chunk.length > WaveDecoder.MAX_HEADER_SIZE) {
          this.state = DecoderState.ERROR;
          return this.createErrorResult('Header size exceeds maximum limit.');
        }
        const combined = new Uint8Array(this.headerBuffer.length + chunk.length);
        combined.set(this.headerBuffer, 0);
        combined.set(chunk, this.headerBuffer.length);
        this.headerBuffer = combined;

        this.tryParseHeader();

        if (this.state === DecoderState.UNINIT) {
          return this.createEmptyResult();
        } else if (this.state === DecoderState.ERROR) {
          return {
            channelData: [],
            samplesDecoded: 0,
            sampleRate: 0,
            errors: [...this.errors],
          };
        }
      } else {
        if (this.ringBuffer.write(chunk) < chunk.length) {
          this.state = DecoderState.ERROR;
          return this.createErrorResult('Audio buffer capacity exceeded.');
        }
      }

      return this.processBufferedBlocks();
    } catch (err) {
      this.state = DecoderState.ERROR;
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(this.createError(`Decode error: ${message}`));
      return this.createErrorResult('Decode error');
    }
  }

  /**
   * Decodes a single, aligned audio frame.
   * This is a highly optimized, low-level method for performance-critical applications.
   * It assumes the decoder is initialized and the input is a single, valid frame.
   * This method does NOT update the decoder's internal byte counters.
   *
   * @param frame - A byte chunk representing exactly one audio frame (its length must equal `format.blockAlign`).
   * @returns A Float32Array containing one decoded sample per channel, or null if the input is invalid or the decoder is not ready.
   */
  public decodeFrame(frame: Uint8Array): Float32Array | null {
    const { blockAlign, numChannels, bitsPerSample } = this.format;

    if (this.state !== DecoderState.DECODING || frame.length !== blockAlign) {
      return null;
    }

    const output = new Float32Array(numChannels);

    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    const bytesPerSample = bitsPerSample / 8;

    for (let ch = 0; ch < numChannels; ch++) {
      const offset = ch * bytesPerSample;
      output[ch] = this.readSample(view, offset, bitsPerSample, this.formatTag);
    }

    return output;
  }

  /**
   * Decodes an aligned chunk of audio data (frames).
   * This assumes the decoder is already initialized and the chunk size
   * is an exact multiple of the format's `blockAlign`.
   *
   * @param frames - A properly aligned frames of WAV audio data.
   * @returns Decoded audio data or an error result.
   */
  public decodeFrames(frames: Uint8Array): DecodedWaveAudio {
    if (this.state !== DecoderState.DECODING) {
      return this.createErrorResult('Decoder must be initialized before decodeFrames().');
    }
    if (frames.length === 0) {
      return this.createEmptyResult();
    }
    if (this.format.blockAlign <= 0 || frames.length % this.format.blockAlign !== 0) {
      return this.createErrorResult('Data for decodeFrames must be a multiple of the `frameLength` (blockAlign).');
    }

    try {
      const decoded = this.decodeInterleavedFrames(frames);
      this.decodedBytes += frames.length;
      this.remainingBytes = Math.max(0, this.remainingBytes - frames.length);
      return decoded;
    } catch (err) {
      this.state = DecoderState.ERROR;
      const message = err instanceof Error ? err.message : String(err);
      this.errors.push(this.createError(`Block decode error: ${message}`));
      return this.createErrorResult('Block decode error');
    }
  }

  /**
   * Finalizes the decoding process and flushes any remaining audio in the buffer.
   * Returns any final decoded audio or null if there’s nothing to flush.
   *
   * @returns The final decoded audio data or null if no audio remains.
   */
  public flush(): DecodedWaveAudio | null {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) return null;

    const result = this.processBufferedBlocks();

    if (this.ringBuffer.available > 0) {
      this.errors.push(this.createError(`Discarded ${this.ringBuffer.available} bytes of incomplete final block.`));
      this.remainingBytes = Math.max(0, this.remainingBytes - this.ringBuffer.available);
      this.ringBuffer.clear();
    }

    this.state = DecoderState.ENDED;
    return result.samplesDecoded > 0 ? result : null;
  }

  private processBufferedBlocks(): DecodedWaveAudio {
    if (
      this.state !== DecoderState.DECODING ||
      !this.format.blockAlign ||
      this.ringBuffer.available < this.format.blockAlign
    ) {
      return this.createEmptyResult();
    }

    const blockSize = this.format.blockAlign;
    const blocksToProcess = Math.floor(this.ringBuffer.available / blockSize);
    const bytesToProcess = blocksToProcess * blockSize;

    const interleavedFrames = this.ringBuffer.read(bytesToProcess);
    if (!interleavedFrames) return this.createEmptyResult();

    const decoded = this.decodeInterleavedFrames(interleavedFrames);

    this.decodedBytes += bytesToProcess;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytesToProcess);

    return decoded;
  }

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWaveAudio {
    const blockSize = this.format.blockAlign;
    if (blockSize <= 0) return this.createEmptyResult();

    const numSamples = Math.floor(frames.length / blockSize);
    const channelData = Array.from({ length: this.format.numChannels }, () => new Float32Array(numSamples));
    const view = new DataView(frames.buffer, frames.byteOffset, frames.length);
    const bps = this.format.bitsPerSample / 8;

    for (let ch = 0; ch < this.format.numChannels; ch++) {
      const channelArray = channelData[ch]!;
      for (let i = 0; i < numSamples; i++) {
        const offset = i * blockSize + ch * bps;
        if (offset + bps <= frames.length) {
          channelArray[i] = this.readSample(view, offset, this.format.bitsPerSample, this.formatTag);
        } else {
          channelArray[i] = 0;
        }
      }
    }

    return {
      channelData: channelData,
      samplesDecoded: numSamples,
      sampleRate: this.format.sampleRate,
      errors: [...this.errors.splice(0)],
    };
  }

  private tryParseHeader(): boolean {
    const headerData = this.headerBuffer;
    if (headerData.length < 12) {
      return false;
    }

    const tempView = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength);

    const readString = (off: number, len: number) => {
      if (off + len > headerData.length) return '';
      return String.fromCharCode(...headerData.subarray(off, off + len));
    };

    const riff = readString(0, 4);
    if (riff !== 'RIFF' && riff !== 'RIFX') {
      this.state = DecoderState.ERROR;
      this.errors.push(this.createError('Invalid WAV file'));
      return false;
    }
    this.isLittleEndian = riff === 'RIFF';

    if (readString(8, 4) !== 'WAVE') {
      this.state = DecoderState.ERROR;
      this.errors.push(this.createError('Invalid WAV file'));
      return false;
    }

    const getUint32 = (off: number) => {
      if (off + 4 > headerData.length) return 0;
      return tempView.getUint32(off, this.isLittleEndian);
    };

    let offset = 12;
    let fmtChunk: ChunkInfo | null = null;
    let dataChunk: ChunkInfo | null = null;
    const parsedChunks: ChunkInfo[] = [];

    while (offset + 8 <= headerData.length) {
      const id = readString(offset, 4);
      const size = getUint32(offset + 4);

      if (id === 'data') {
        dataChunk = { id, size, offset };
        parsedChunks.push(dataChunk);
        break;
      }

      const chunkEnd = offset + 8 + size + (size % 2);
      if (chunkEnd > headerData.length) {
        return false;
      }

      const chunkInfo = { id, size, offset };
      parsedChunks.push(chunkInfo);
      if (id === 'fmt ') {
        fmtChunk = chunkInfo;
      }

      offset = chunkEnd;
    }

    if (!fmtChunk || !dataChunk) {
      return false;
    }

    this.parseFormatChunk(fmtChunk, headerData);
    if (!this.validateFormat()) {
      this.state = DecoderState.ERROR;
      return false;
    }

    this.parsedChunks = parsedChunks.filter((c) => ['fmt ', 'data', 'fact'].includes(c.id));
    this.unhandledChunks = parsedChunks.filter((c) => !['fmt ', 'data', 'fact'].includes(c.id));

    const fact = parsedChunks.find((c) => c.id === 'fact');
    if (fact && fact.offset + 12 <= headerData.length) {
      this.factChunkSamples = getUint32(fact.offset + 8);
    }

    this.remainingBytes = this.totalBytes = dataChunk.size;

    const headerEndOffset = dataChunk.offset + 8;
    const leftover = this.headerBuffer.subarray(headerEndOffset);
    if (leftover.length > 0) this.ringBuffer.write(leftover);

    this.headerBuffer = new Uint8Array(0);
    this.state = DecoderState.DECODING;
    return true;
  }

  private parseFormatChunk(chunk: ChunkInfo, headerData: Uint8Array): void {
    const offset = chunk.offset + 8;
    const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.length);

    if (offset + 16 > headerData.length) {
      this.errors.push(this.createError('Format chunk too small'));
      return;
    }

    this.format = {
      format: view.getUint16(offset, this.isLittleEndian),
      numChannels: view.getUint16(offset + 2, this.isLittleEndian),
      sampleRate: view.getUint32(offset + 4, this.isLittleEndian),
      byteRate: view.getUint32(offset + 8, this.isLittleEndian),
      blockAlign: view.getUint16(offset + 12, this.isLittleEndian),
      bitsPerSample: view.getUint16(offset + 14, this.isLittleEndian),
    };

    this.formatTag = this.format.format;

    if (this.format.format === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40 && offset + 40 <= headerData.length) {
      this.format.extensionSize = view.getUint16(offset + 16, this.isLittleEndian);
      this.format.validBitsPerSample = view.getUint16(offset + 18, this.isLittleEndian);
      this.format.channelMask = view.getUint32(offset + 20, this.isLittleEndian);
      this.format.subFormat = headerData.subarray(offset + 24, offset + 40);
      this.formatTag = this.resolveExtensibleFormat();
    }
  }

  private resolveExtensibleFormat(): number {
    const sf = this.format.subFormat;
    if (!sf) return this.format.format;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
    return this.format.format;
  }

  private validateFormat(): boolean {
    if (this.format.bitsPerSample === 0 || this.format.numChannels === 0 || this.format.sampleRate === 0) {
      this.errors.push(this.createError('Invalid format: zero values in required fields'));
      return false;
    }

    if (this.format.numChannels > WaveDecoder.MAX_CHANNELS) {
      this.errors.push(
        this.createError(`Too many channels: ${this.format.numChannels} (max ${WaveDecoder.MAX_CHANNELS})`)
      );
      return false;
    }

    if (this.format.sampleRate > WaveDecoder.MAX_SAMPLE_RATE) {
      this.errors.push(
        this.createError(`Sample rate too high: ${this.format.sampleRate} (max ${WaveDecoder.MAX_SAMPLE_RATE})`)
      );
      return false;
    }

    if (![WAVE_FORMAT_PCM, WAVE_FORMAT_IEEE_FLOAT, WAVE_FORMAT_ALAW, WAVE_FORMAT_MULAW].includes(this.formatTag)) {
      this.errors.push(this.createError(`Unsupported audio format: 0x${this.formatTag.toString(16)}`));
      return false;
    }

    const expectedBlockAlign = (this.format.bitsPerSample / 8) * this.format.numChannels;
    if (this.format.blockAlign !== expectedBlockAlign) {
      this.errors.push(
        this.createError(`Invalid blockAlign: expected ${expectedBlockAlign}, got ${this.format.blockAlign}`)
      );
      return false;
    }

    const valid = this.getValidBitDepths(this.formatTag);
    if (!valid.includes(this.format.bitsPerSample)) {
      this.errors.push(
        this.createError(`Invalid bit depth: ${this.format.bitsPerSample} for format 0x${this.formatTag.toString(16)}`)
      );
      return false;
    }
    return true;
  }

  private getValidBitDepths(fmt: number): number[] {
    switch (fmt) {
      case WAVE_FORMAT_PCM:
        return [8, 16, 24, 32];
      case WAVE_FORMAT_IEEE_FLOAT:
        return [32, 64];
      case WAVE_FORMAT_ALAW:
      case WAVE_FORMAT_MULAW:
        return [8];
      default:
        return [];
    }
  }

  private readSample(view: DataView, offset: number, bits: number, fmt: number): number {
    try {
      switch (fmt) {
        case WAVE_FORMAT_PCM:
          return this.readPcm(view, offset, bits);
        case WAVE_FORMAT_IEEE_FLOAT:
          return this.readFloat(view, offset, bits);
        case WAVE_FORMAT_ALAW:
          return this.readAlaw(view, offset);
        case WAVE_FORMAT_MULAW:
          return this.readMulaw(view, offset);
        default:
          return 0;
      }
    } catch {
      return 0;
    }
  }

  private readPcm(view: DataView, off: number, bits: number): number {
    switch (bits) {
      case 8:
        return (view.getUint8(off) - 128) / 128;
      case 16:
        return view.getInt16(off, this.isLittleEndian) / 32768;
      case 24: {
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let val = 0;
        if (this.isLittleEndian) {
          val = (b2 << 16) | (b1 << 8) | b0;
        } else {
          val = (b0 << 16) | (b1 << 8) | b2;
        }
        if (val & 0x800000) {
          val |= 0xff000000;
        }
        return val / 8388608;
      }
      case 32:
        return view.getInt32(off, this.isLittleEndian) / 2147483648;
      default:
        return 0;
    }
  }

  private readFloat(view: DataView, off: number, bits: number): number {
    switch (bits) {
      case 32:
        return Math.max(-1, Math.min(1, view.getFloat32(off, this.isLittleEndian)));
      case 64:
        return Math.max(-1, Math.min(1, view.getFloat64(off, this.isLittleEndian)));
      default:
        return 0;
    }
  }

  private readAlaw(view: DataView, off: number): number {
    return WaveDecoder.ALAW_TABLE[view.getUint8(off)] || 0;
  }

  private readMulaw(view: DataView, off: number): number {
    return WaveDecoder.MULAW_TABLE[view.getUint8(off)] || 0;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private createEmptyResult(): DecodedWaveAudio {
    return {
      channelData: [],
      samplesDecoded: 0,
      sampleRate: this.format.sampleRate || 0,
      errors: [...this.errors.splice(0)],
    };
  }

  private createErrorResult(msg: string): DecodedWaveAudio {
    this.errors.push(this.createError(msg));
    return {
      channelData: [],
      samplesDecoded: 0,
      sampleRate: this.format.sampleRate || 0,
      errors: [...this.errors],
    };
  }

  private createError(message: string): DecodeError {
    const blockSize = this.format.blockAlign || 0;
    return {
      message: message,
      frameLength: blockSize,
      frameNumber: blockSize > 0 ? Math.floor(this.decodedBytes / blockSize) : 0,
      inputBytes: this.decodedBytes,
      outputSamples: blockSize > 0 ? Math.floor(this.decodedBytes / blockSize) : 0,
    };
  }
}
