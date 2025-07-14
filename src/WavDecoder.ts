import {
  type ChunkInfo,
  type DecodedWavAudio,
  type DecodeError,
  type DecoderOptions,
  DecoderState,
  type WavDecoderInfo,
  type WavFormat,
} from './types';
import { RingBuffer } from './RingBuffer';

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

const ALAW_TABLE = (() => {
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
})();

const MULAW_TABLE = (() => {
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
})();

export interface WavDecoderInterface {
  info: WavDecoderInfo;

  decode(chunk: Uint8Array): DecodedWavAudio;

  decodeFrame(frame: Uint8Array): Float32Array | null;

  decodeFrames(frames: Uint8Array): DecodedWavAudio;

  flush(): DecodedWavAudio;

  reset(): void;

  free(): void;
}

export class WavDecoder implements WavDecoderInterface {
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;
  private static readonly MAX_CHANNELS = 32;
  private readonly errors: DecodeError[] = [];

  private state = DecoderState.UNINIT;
  private ringBuffer: RingBuffer;
  private format = {} as WavFormat;
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

  private decodeBuffer!: ArrayBuffer;
  private channelData: Float32Array[] = [];

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);

    this.decodeBuffer = new ArrayBuffer(4096);
  }

  public get info() {
    return {
      state: this.state,
      formatTag: this.formatTag,
      decodedBytes: this.decodedBytes,
      remainingBytes: this.remainingBytes,
      totalBytes: this.totalBytes,
      progress: this.totalBytes > 0 ? (this.totalBytes - this.remainingBytes) / this.totalBytes : 0,
      duration: this.format.sampleRate > 0 ? this.estimatedSamples / this.format.sampleRate : 0,
      format: { ...this.format },
      errors: [...this.errors],
      parsedChunks: [...this.parsedChunks],
      unhandledChunks: [...this.unhandledChunks],
    };
  }

  public get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockSize > 0) {
      return Math.floor(this.totalBytes / this.format.blockSize);
    }
    return 0;
  }

  public free(): void {
    this.reset();
    this.state = DecoderState.ENDED;
  }

  public reset(): void {
    this.state = DecoderState.UNINIT;
    this.ringBuffer.clear();
    this.errors.length = 0;
    this.format = {} as WavFormat;
    this.remainingBytes = this.decodedBytes = this.totalBytes = this.factChunkSamples = 0;
    this.parsedChunks = [];
    this.unhandledChunks = [];
    this.formatTag = 0;
    this.isLittleEndian = true;
    this.headerBuffer = new Uint8Array(0);
    this.channelData = [];
  }

  public decode(chunk: Uint8Array): DecodedWavAudio {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createErrorResult('Decoder is in a terminal state.');
    }
    try {
      if (this.state === DecoderState.UNINIT) {
        if (this.headerBuffer.length + chunk.length > WavDecoder.MAX_HEADER_SIZE) {
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
            bitDepth: this.format.bitDepth,
            duration: this.format.sampleRate > 0 ? this.estimatedSamples / this.format.sampleRate : 0,
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
    const { blockSize, channels, bitDepth } = this.format;
    if (this.state !== DecoderState.DECODING || frame.length !== blockSize) {
      return null;
    }
    const output = new Float32Array(channels);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    const bytesPerSample = bitDepth / 8;
    for (let ch = 0; ch < channels; ch++) {
      const offset = ch * bytesPerSample;
      output[ch] = this.readSample(view, offset, bitDepth, this.formatTag);
    }
    return output;
  }

  public decodeFrames(frames: Uint8Array): DecodedWavAudio {
    if (this.state !== DecoderState.DECODING) {
      return this.createErrorResult('Decoder must be initialized before decodeFrames().');
    }
    if (frames.length === 0) {
      return this.createEmptyResult();
    }
    if (this.format.blockSize <= 0 || frames.length % this.format.blockSize !== 0) {
      return this.createErrorResult('Data for decodeFrames must be a multiple of the `frameLength` (blockSize).');
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

  public flush(): DecodedWavAudio {
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
        bitDepth: this.format.bitDepth || 0,
        duration: this.format.sampleRate > 0 ? this.estimatedSamples / this.format.sampleRate : 0,
      };
    }
  }

  private processBufferedBlocks(): DecodedWavAudio {
    const { blockSize } = this.format;
    if (this.state !== DecoderState.DECODING || !blockSize || this.ringBuffer.available < blockSize)
      return this.createEmptyResult();

    const blocks = Math.floor(this.ringBuffer.available / blockSize);
    const bytes = blocks * blockSize;

    const tail = this.ringBuffer.peekContiguous();
    if (tail.length >= bytes) {
      const out = this.decodeInterleavedFrames(tail.subarray(0, bytes));
      this.ringBuffer.discard(bytes);
      this.decodedBytes += bytes;
      this.remainingBytes = Math.max(0, this.remainingBytes - bytes);
      return out;
    }

    if (this.decodeBuffer.byteLength < bytes) {
      let sz = this.decodeBuffer.byteLength || 4096;
      while (sz < bytes) sz <<= 1;
      this.decodeBuffer = new ArrayBuffer(sz);
    }
    const scratch = new Uint8Array(this.decodeBuffer, 0, bytes);

    const headLen = bytes - tail.length;
    const head = this.ringBuffer.peek(headLen, tail.length);

    scratch.set(tail, 0);
    scratch.set(head, tail.length);

    const out = this.decodeInterleavedFrames(scratch);

    this.ringBuffer.discard(bytes);
    this.decodedBytes += bytes;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytes);
    return out;
  }

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWavAudio {
    const { blockSize, channels, sampleRate, bitDepth } = this.format;
    const samplesDecoded = frames.length / blockSize;
    const bps = this.bytesPerSample;

    if (this.channelData.length !== channels) {
      this.channelData = Array.from({ length: channels }, () => new Float32Array(samplesDecoded));
    } else {
      for (let i = 0; i < channels; i++) {
        const neededLength = samplesDecoded;
        const current = this.channelData[i];
        if (!current || current.length < neededLength) {
          this.channelData[i] = new Float32Array(neededLength);
        }
      }
    }

    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);

    switch (this.formatTag) {
      case WAVE_FORMAT_PCM: {
        if (channels === 1 && bitDepth === 16) {
          this.decodePCM16Mono(view, samplesDecoded);
        } else if (channels === 2 && bitDepth === 16) {
          this.decodePCM16Stereo(view, samplesDecoded);
        } else if (channels === 2 && bitDepth === 24) {
          this.decodePCM24Stereo(view, samplesDecoded);
        } else {
          this.decodeGenericPCM(view, samplesDecoded, bps, bitDepth);
        }
        break;
      }
      case WAVE_FORMAT_IEEE_FLOAT: {
        if (channels === 2 && bitDepth === 32) {
          this.decodeFloat32Stereo(view, samplesDecoded);
        } else {
          this.decodeFloat(view, samplesDecoded, bps, bitDepth);
        }
        break;
      }
      case WAVE_FORMAT_ALAW:
      case WAVE_FORMAT_MULAW: {
        this.decodeCompressed(view, samplesDecoded);
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
      bitDepth: this.format.bitDepth || 0,
      duration: sampleRate > 0 ? samplesDecoded / sampleRate : 0,
    };
  }

  private decodePCM16Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const isLE = this.isLittleEndian;
    for (let i = 0; i < samples; i++) {
      const offset = i * 4;
      left[i] = view.getInt16(offset, isLE) * 0.000030517578125;
      right[i] = view.getInt16(offset + 2, isLE) * 0.000030517578125;
    }
  }

  // Step 2: Fast-path kernels
  private decodePCM16Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    const isLE = this.isLittleEndian;
    for (let i = 0; i < samples; i++) {
      const offset = i * 2;
      mono[i] = view.getInt16(offset, isLE) * 0.000030517578125;
    }
  }

  private decodeFloat32Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const isLE = this.isLittleEndian;
    for (let i = 0; i < samples; i++) {
      const offset = i * 8;
      left[i] = Math.max(-1, Math.min(1, view.getFloat32(offset, isLE)));
      right[i] = Math.max(-1, Math.min(1, view.getFloat32(offset + 4, isLE)));
    }
  }

  private decodePCM24Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const isLE = this.isLittleEndian;
    let offset = 0;

    for (let i = 0; i < samples; i++) {
      let b0 = view.getUint8(offset);
      let b1 = view.getUint8(offset + 1);
      let b2 = view.getUint8(offset + 2);
      let val: number;

      if (isLE) {
        val = (b2 << 16) | (b1 << 8) | b0;
      } else {
        val = (b0 << 16) | (b1 << 8) | b2;
      }

      if (val & 0x800000) val |= 0xff000000;
      left[i] = val / 8388608;

      offset += 3;

      b0 = view.getUint8(offset);
      b1 = view.getUint8(offset + 1);
      b2 = view.getUint8(offset + 2);

      if (isLE) {
        val = (b2 << 16) | (b1 << 8) | b0;
      } else {
        val = (b0 << 16) | (b1 << 8) | b2;
      }

      if (val & 0x800000) val |= 0xff000000;
      right[i] = val / 8388608;

      offset += 3;
    }
  }

  private decodeGenericPCM(view: DataView, samples: number, bytesPerSample: number, bitsPerSample: number): void {
    const numChannels = this.format.channels;
    let offset = 0;

    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        if (offset + bytesPerSample > view.byteLength) {
          this.channelData[ch]![i] = 0;
          continue;
        }
        this.channelData[ch]![i] = this.readPcm(view, offset, bitsPerSample);
        offset += bytesPerSample;
      }
    }
  }

  private decodeFloat(view: DataView, samples: number, bps: number, bitsPerSample: number): void {
    const numChannels = this.format.channels;
    const blockSize = this.format.blockSize;
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

  // Step 4: Optimize A-law/µ-law lookup
  private decodeCompressed(view: DataView, samples: number): void {
    const numChannels = this.format.channels;
    const blockSize = this.format.blockSize;
    const table = this.formatTag === WAVE_FORMAT_ALAW ? ALAW_TABLE : MULAW_TABLE;
    const src = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = base + ch;
        this.channelData[ch]![i] = table[src[offset]!]!;
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
      formatTag: view.getUint16(offset, this.isLittleEndian),
      channels: view.getUint16(offset + 2, this.isLittleEndian),
      sampleRate: view.getUint32(offset + 4, this.isLittleEndian),
      bytesPerSecond: view.getUint32(offset + 8, this.isLittleEndian),
      blockSize: view.getUint16(offset + 12, this.isLittleEndian),
      bitDepth: view.getUint16(offset + 14, this.isLittleEndian),
    };

    this.formatTag = this.format.formatTag;
    this.bytesPerSample = this.format.bitDepth / 8;

    if (this.format.formatTag === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40 && offset + 40 <= headerData.length) {
      this.format.extensionSize = view.getUint16(offset + 16, this.isLittleEndian);
      this.format.validBitsPerSample = view.getUint16(offset + 18, this.isLittleEndian);
      this.format.channelMask = view.getUint32(offset + 20, this.isLittleEndian);
      this.format.subFormat = headerData.subarray(offset + 24, offset + 40);
      this.formatTag = this.resolveExtensibleFormat();
    }
  }

  private resolveExtensibleFormat(): number {
    const sf = this.format.subFormat;
    if (!sf) return this.format.formatTag;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
    return this.format.formatTag;
  }

  private validateFormat(): boolean {
    if (this.format.bitDepth === 0 || this.format.channels === 0 || this.format.sampleRate === 0) {
      this.errors.push(this.createError('Invalid formatTag: zero values in required fields'));
      return false;
    }
    if (this.format.channels > WavDecoder.MAX_CHANNELS) {
      this.errors.push(this.createError(`Too many channels: ${this.format.channels} (max ${WavDecoder.MAX_CHANNELS})`));
      return false;
    }
    if (this.format.sampleRate > WavDecoder.MAX_SAMPLE_RATE) {
      this.errors.push(
        this.createError(`Sample rate too high: ${this.format.sampleRate} (max ${WavDecoder.MAX_SAMPLE_RATE})`),
      );
      return false;
    }
    if (![WAVE_FORMAT_PCM, WAVE_FORMAT_IEEE_FLOAT, WAVE_FORMAT_ALAW, WAVE_FORMAT_MULAW].includes(this.formatTag)) {
      this.errors.push(this.createError(`Unsupported audio format: 0x${this.formatTag.toString(16)}`));
      return false;
    }

    const expectedBlockAlign = (this.format.bitDepth / 8) * this.format.channels;
    if (this.format.blockSize !== expectedBlockAlign && expectedBlockAlign > 0) {
      this.errors.push(
        this.createError(
          `Corrected invalid blockAlign: header value was ${this.format.blockSize}, but is now ${expectedBlockAlign}`,
        ),
      );
      this.format.blockSize = expectedBlockAlign;
    }

    const expectedByteRate = this.format.sampleRate * this.format.blockSize;
    if (this.format.bytesPerSecond !== expectedByteRate && expectedByteRate > 0) {
      this.errors.push(
        this.createError(
          `Corrected invalid byteRate: header value was ${this.format.bytesPerSecond}, but is now ${expectedByteRate}`,
        ),
      );
      this.format.bytesPerSecond = expectedByteRate;
    }

    const valid = this.getValidBitDepths(this.formatTag);
    if (!valid.includes(this.format.bitDepth)) {
      this.errors.push(
        this.createError(`Invalid bit depth: ${this.format.bitDepth} for format 0x${this.formatTag.toString(16)}`),
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
        if (off + 4 > view.byteLength) {
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
        const val = (view.getInt32(off, this.isLittleEndian) << 8) >> 8;
        return val * (1 / 8388608);
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
    return ALAW_TABLE[view.getUint8(off)] ?? 0;
  }

  private readMulaw(view: DataView, off: number): number {
    return MULAW_TABLE[view.getUint8(off)] ?? 0;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private createEmptyResult(): DecodedWavAudio {
    const errors = [...this.errors];
    this.errors.length = 0;
    return {
      channelData: [],
      samplesDecoded: 0,
      sampleRate: this.format.sampleRate,
      bitDepth: this.format.bitDepth,
      duration: this.format.sampleRate > 0 ? this.estimatedSamples / this.format.sampleRate : 0,
      errors,
    };
  }

  private createErrorResult(msg: string): DecodedWavAudio {
    this.errors.push(this.createError(msg));
    return this.createEmptyResult();
  }

  private createError(message: string): DecodeError {
    const blockSize = this.format.blockSize ?? 0;
    return {
      message: message,
      frameLength: blockSize,
      frameNumber: blockSize > 0 ? Math.floor(this.decodedBytes / blockSize) : 0,
      inputBytes: this.decodedBytes,
      outputSamples: this.estimatedSamples,
    };
  }
}
