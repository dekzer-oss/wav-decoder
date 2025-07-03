import type { DecodedWaveAudio, DecodeError, InterleavedDecodeResult, WaveFormat } from './types';
import { RingBuffer } from './RingBuffer.ts';

export enum DecoderState {
  UNINIT,
  DECODING,
  ENDED,
  ERROR,
}

/** @internal */
interface ChunkInfo {
  id: string;
  size: number;
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
  maxBufferSize?: number;
}

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
  private bytesPerSample = 0;

  // Reusable buffers to avoid allocations
  private decodeView!: DataView;
  private decodeBuffer!: ArrayBuffer;
  private channelData: Float32Array[] = [];

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WaveDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);

    this.decodeBuffer = new ArrayBuffer(4096);
    this.decodeView = new DataView(this.decodeBuffer);
  }

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

  public free(): void {
    this.reset();
    this.state = DecoderState.ENDED;
  }

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
    this.channelData = [];
  }

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

  public flush(): DecodedWaveAudio {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createEmptyResult();
    }
    const result = this.processBufferedBlocks();
    const leftoverBytes = this.ringBuffer.available;
    if (leftoverBytes > 0) {
      const error = this.createError(`Discarded ${leftoverBytes} bytes of incomplete final block.`);
      this.errors.push(error);
      this.remainingBytes = Math.max(0, this.remainingBytes - leftoverBytes);
      this.ringBuffer.clear();
    }
    this.state = DecoderState.ENDED;

    // Combine errors from the last block processing with any new errors from flushing
    const finalErrors = [...result.errors, ...this.errors];
    this.errors.length = 0;

    if (result.samplesDecoded > 0) {
      return { ...result, errors: finalErrors };
    } else {
      return {
        channelData: [],
        samplesDecoded: 0,
        sampleRate: this.format.sampleRate || 0,
        errors: finalErrors,
      };
    }
  }

  private processBufferedBlocks(): DecodedWaveAudio {
    const blockSize = this.format.blockAlign;
    if (this.state !== DecoderState.DECODING || !blockSize || this.ringBuffer.available < blockSize) {
      return this.createEmptyResult();
    }

    const blocksToProcess = Math.floor(this.ringBuffer.available / blockSize);
    const bytesToProcess = blocksToProcess * blockSize;

    const contiguous = this.ringBuffer.peekContiguous();
    let decoded: DecodedWaveAudio;

    if (contiguous.length >= bytesToProcess) {
      decoded = this.decodeInterleavedFrames(contiguous.subarray(0, bytesToProcess));
      this.ringBuffer.discard(bytesToProcess);
    } else {
      const frames = this.ringBuffer.read(bytesToProcess);
      decoded = this.decodeInterleavedFrames(frames!);
    }

    this.decodedBytes += bytesToProcess;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytesToProcess);
    return decoded;
  }

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWaveAudio {
    const { blockAlign, numChannels, sampleRate, bitsPerSample } = this.format;
    const samplesDecoded = frames.length / blockAlign;
    const bps = this.bytesPerSample;

    if (this.channelData.length !== numChannels) {
      this.channelData = Array.from({ length: numChannels }, () => new Float32Array(samplesDecoded));
    } else {
      for (let i = 0; i < numChannels; i++) {
        const neededLength = samplesDecoded;
        const current = this.channelData[i];
        if (!current || current.length < neededLength) {
          this.channelData[i] = new Float32Array(neededLength);
        }
      }
    }

    if (this.decodeBuffer.byteLength < frames.length) {
      let newSize = this.decodeBuffer.byteLength;
      while (newSize < frames.length) newSize *= 2;
      this.decodeBuffer = new ArrayBuffer(newSize);
      this.decodeView = new DataView(this.decodeBuffer);
    }
    new Uint8Array(this.decodeBuffer).set(frames);

    switch (this.formatTag) {
      case WAVE_FORMAT_PCM: {
        if (numChannels === 2 && bitsPerSample === 16) {
          this.decodePCM16Stereo(samplesDecoded);
        } else {
          this.decodeGenericPCM(samplesDecoded, bps, bitsPerSample);
        }
        break;
      }
      case WAVE_FORMAT_IEEE_FLOAT: {
        this.decodeFloat(samplesDecoded, bps, bitsPerSample);
        break;
      }
      case WAVE_FORMAT_ALAW:
      case WAVE_FORMAT_MULAW: {
        this.decodeCompressed(samplesDecoded);
        break;
      }
      default:
        this.channelData.forEach((arr) => arr.fill(0));
    }

    const errors = [...this.errors];
    this.errors.length = 0;

    return {
      channelData: this.channelData.map((arr) => arr.subarray(0, samplesDecoded)),
      samplesDecoded,
      sampleRate,
      errors,
    };
  }

  private decodePCM16Stereo(samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const view = this.decodeView;
    const isLE = this.isLittleEndian;
    for (let i = 0; i < samples; i++) {
      const offset = i * 4;
      left[i] = view.getInt16(offset, isLE) * 0.000030517578125;
      right[i] = view.getInt16(offset + 2, isLE) * 0.000030517578125;
    }
  }

  private decodeGenericPCM(samples: number, bps: number, bits: number): void {
    const view = this.decodeView;
    const blockSize = this.format.blockAlign;
    const numChannels = this.format.numChannels;
    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = base + ch * bps;
        this.channelData[ch]![i] = this.readPcm(view, offset, bits);
      }
    }
  }

  private decodeFloat(samples: number, bps: number, bitsPerSample: number): void {
    const view = this.decodeView;
    const numChannels = this.format.numChannels;
    const blockSize = this.format.blockAlign;
    const is64Bit = bitsPerSample === 64;

    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = base + ch * bps;
        let value: number;
        if (is64Bit) {
          value = view.getFloat64(offset, this.isLittleEndian);
        } else {
          value = view.getFloat32(offset, this.isLittleEndian);
        }
        this.channelData[ch]![i] = Math.max(-1, Math.min(1, value));
      }
    }
  }

  private decodeCompressed(samples: number): void {
    const view = this.decodeView;
    const numChannels = this.format.numChannels;
    const blockSize = this.format.blockAlign;
    const decode = this.formatTag === WAVE_FORMAT_ALAW ? this.readAlaw.bind(this) : this.readMulaw.bind(this);
    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = base + ch;
        this.channelData[ch]![i] = decode(view, offset);
      }
    }
  }

  private tryParseHeader(): boolean {
    const headerData = this.headerBuffer;
    if (headerData.length < 12) return false;

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
      if (chunkEnd > headerData.length) return false;

      const chunkInfo = { id, size, offset };
      parsedChunks.push(chunkInfo);
      if (id === 'fmt ') fmtChunk = chunkInfo;
      offset = chunkEnd;
    }

    if (!fmtChunk || !dataChunk) return false;

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
    this.bytesPerSample = this.format.bitsPerSample / 8;

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
    if (this.format.blockAlign !== (this.format.bitsPerSample / 8) * this.format.numChannels) {
      const expectedBlockAlign = (this.format.bitsPerSample / 8) * this.format.numChannels;
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
        return (view.getUint8(off) - 128) * 0.0078125;
      case 16:
        return view.getInt16(off, this.isLittleEndian) * 0.000030517578125;
      case 24: {
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let val: number;
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
        return view.getInt32(off, this.isLittleEndian) * 4.656612875245797e-10;
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
    const errors = [...this.errors];
    this.errors.length = 0;
    return {
      channelData: [],
      samplesDecoded: 0,
      sampleRate: this.format.sampleRate || 0,
      errors,
    };
  }

  private createErrorResult(msg: string): DecodedWaveAudio {
    this.errors.push(this.createError(msg));
    return this.createEmptyResult();
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

  public decodeIntoInterleaved(input: Uint8Array, output: Float32Array, offsetFrames = 0): InterleavedDecodeResult {
    const { formatTag, format } = this;
    const { blockAlign, numChannels, bitsPerSample } = format;
    const samplesDecoded = Math.floor(input.length / blockAlign);

    if (formatTag !== WAVE_FORMAT_PCM || numChannels !== 2 || bitsPerSample !== 16) {
      return {
        samplesDecoded,
        errors: [this.createError('Unsupported format for decodeIntoInterleaved')],
      };
    }

    const view = new DataView(input.buffer, input.byteOffset, input.length);
    const outOffset = offsetFrames * numChannels;
    const isLE = this.isLittleEndian;

    for (let i = 0; i < samplesDecoded; i++) {
      const base = i * blockAlign;
      const left = view.getInt16(base, isLE) / 0x8000;
      const right = view.getInt16(base + 2, isLE) / 0x8000;
      const outIndex = outOffset + i * 2;
      output[outIndex] = left;
      output[outIndex + 1] = right;
    }

    return {
      samplesDecoded,
      errors: [...this.errors],
    };
  }
}
