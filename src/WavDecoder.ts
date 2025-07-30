import {
  type ChunkInfo,
  type DecodedWavAudio,
  type DecodeError,
  type DecoderOptions,
  DecoderState,
  type WavAudioDecoder,
  type WavFormat,
} from './types';
import { RingBuffer } from './RingBuffer';

const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IMA_ADPCM = 0x0011;

const imaStepTable = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

const imaIndexAdjustTable = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

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

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Uint8Array([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

const KSDATAFORMAT_SUBTYPE_PCM = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

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

export class WavDecoder implements WavAudioDecoder {
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_CHANNELS = 32;
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;

  private bytesPerSample = 0;
  private channelData: Float32Array[] = [];
  private decodeBuffer!: ArrayBuffer;
  private decodedBytes = 0;
  private errors: DecodeError[] = [];
  private factChunkSamples = 0;
  private format = {} as WavFormat;
  private formatTag = 0;
  private headerBuffer = new Uint8Array(0);
  private isLittleEndian = true;
  private parsedChunks: ChunkInfo[] = [];
  private remainingBytes = 0;
  private ringBuffer: RingBuffer;
  private state = DecoderState.IDLE;
  private totalBytes = 0;
  private unhandledChunks: ChunkInfo[] = [];

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);
    this.decodeBuffer = new ArrayBuffer(4096);
  }

  public get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockAlign > 0) {
      if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
        const blocks = Math.floor(this.totalBytes / this.format.blockAlign);
        return blocks * (this.format.samplesPerBlock ?? 0);
      }
      return Math.floor(this.totalBytes / this.format.blockAlign);
    }
    return 0;
  }

  public get info() {
    return {
      decodedBytes: this.decodedBytes,
      errors: [...this.errors],
      format: { ...this.format },
      formatTag: this.formatTag,
      parsedChunks: [...this.parsedChunks],
      progress: this.totalBytes > 0 ? (this.totalBytes - this.remainingBytes) / this.totalBytes : 0,
      remainingBytes: this.remainingBytes,
      state: this.state,
      totalBytes: this.totalBytes,
      totalDuration:
        this.format.sampleRate > 0 ? this.estimatedSamples / this.format.sampleRate : 0,
      unhandledChunks: [...this.unhandledChunks],
    };
  }

  public static supports(formatTag: number): boolean {
    return [
      WAVE_FORMAT_PCM,
      WAVE_FORMAT_IEEE_FLOAT,
      WAVE_FORMAT_ALAW,
      WAVE_FORMAT_MULAW,
      WAVE_FORMAT_IMA_ADPCM,
    ].includes(formatTag);
  }

  public decode(chunk: Uint8Array): DecodedWavAudio {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createErrorResult('Decoder is in a terminal state.');
    }
    try {
      if (this.state === DecoderState.IDLE) {
        if (this.headerBuffer.length + chunk.length > WavDecoder.MAX_HEADER_SIZE) {
          this.state = DecoderState.ERROR;
          return this.createErrorResult('Header size exceeds maximum limit.');
        }
        const combined = new Uint8Array(this.headerBuffer.length + chunk.length);
        combined.set(this.headerBuffer, 0);
        combined.set(chunk, this.headerBuffer.length);
        this.headerBuffer = combined;
        this.tryParseHeader();
        if (this.state === DecoderState.IDLE) {
          return this.createEmptyResult();
        } else if (this.state === DecoderState.ERROR) {
          return {
            bitDepth: this.format.bitDepth,
            channelData: [],
            errors: [...this.errors],
            sampleRate: 0,
            samplesDecoded: 0,
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
    if (this.state !== DecoderState.DECODING || frame.length !== this.format.blockAlign) {
      return null;
    }
    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      return null;
    }
    const { channels, bitDepth } = this.format;
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
    if (this.format.blockAlign <= 0 || frames.length % this.format.blockAlign !== 0) {
      return this.createErrorResult(
        'Data for decodeFrames must be a multiple of the `frameLength` (blockAlign).',
      );
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
        bitDepth: this.format.bitDepth || 0,
        channelData: [],
        errors: finalErrors,
        sampleRate: this.format.sampleRate || 0,
        samplesDecoded: 0,
      };
    }
  }

  public free(): void {
    this.reset();
    this.state = DecoderState.ENDED;
  }

  public reset(): void {
    this.state = DecoderState.IDLE;
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

  public async *stream(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<DecodedWavAudio> {
    this.reset();
    const reader = stream.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          yield this.flush();
          break;
        }

        try {
          yield this.decode(value);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.errors.push(this.createError(`Decode error: ${message}`));
          yield this.createErrorResult('Decode error');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private createError(message: string): DecodeError {
    const blockAlign = this.format.blockAlign ?? 0;
    return {
      frameLength: blockAlign,
      frameNumber: blockAlign > 0 ? Math.floor(this.decodedBytes / blockAlign) : 0,
      inputBytes: this.decodedBytes,
      message: message,
      outputSamples: this.estimatedSamples,
    };
  }

  private createEmptyResult(): DecodedWavAudio {
    const errors = [...this.errors];
    this.errors.length = 0;
    return {
      bitDepth: this.format.bitDepth,
      channelData: [],
      errors,
      sampleRate: this.format.sampleRate,
      samplesDecoded: 0,
    };
  }

  private createErrorResult(msg: string): DecodedWavAudio {
    this.errors.push(this.createError(msg));
    return this.createEmptyResult();
  }

  private decodeImaAdpcmBlock(
    compressed: Uint8Array,
    headers: {
      predictor: number;
      stepIndex: number;
    }[],
    samplesPerBlock: number,
    channels: number,
    channelData: Float32Array[],
    outputOffset: number,
  ): void {
    const predictors = headers.map((h) => h.predictor);
    const stepIndices = headers.map((h) => Math.min(88, Math.max(0, h.stepIndex)));

    for (let ch = 0; ch < channels; ch++) {
      channelData[ch]![outputOffset] = Math.max(-1, Math.min(1, predictors[ch]! / 32768));
    }

    const dataSize = compressed.length;

    for (let s = 1; s < samplesPerBlock; s++) {
      for (let ch = 0; ch < channels; ch++) {
        const nibbleIndex = (s - 1) * channels + ch;
        const byteIndex = Math.floor(nibbleIndex / 2);

        if (byteIndex >= dataSize) {
          channelData[ch]![outputOffset + s] = channelData[ch]![outputOffset + s - 1]!;
          continue;
        }

        const byte = compressed[byteIndex]!;
        const isLowNibble = nibbleIndex % 2 === 0;
        const nibble = isLowNibble ? byte & 0x0f : byte >> 4;

        const step = imaStepTable[stepIndices[ch]!]!;

        let diff = step >> 3;
        if (nibble & 1) diff += step >> 2;
        if (nibble & 2) diff += step >> 1;
        if (nibble & 4) diff += step;
        if (nibble & 8) diff = -diff;

        predictors[ch]! += diff;
        predictors[ch] = Math.max(-32768, Math.min(32767, predictors[ch]!));
        stepIndices[ch] = Math.min(
          88,
          Math.max(0, stepIndices[ch]! + imaIndexAdjustTable[nibble]!),
        );

        channelData[ch]![outputOffset + s] = Math.max(-1, Math.min(1, predictors[ch]! / 32768));
      }
    }
  }

  private decodeCompressed(view: DataView, samples: number): void {
    const numChannels = this.format.channels;
    const blockAlign = this.format.blockAlign;
    const table = this.formatTag === WAVE_FORMAT_ALAW ? ALAW_TABLE : MULAW_TABLE;
    const src = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    for (let i = 0; i < samples; i++) {
      const base = i * blockAlign;
      for (let ch = 0; ch < numChannels; ch++) {
        const offset = base + ch;
        this.channelData[ch]![i] = table[src[offset]!]!;
      }
    }
  }

  private decodeFloat(view: DataView, samples: number, bps: number, bitsPerSample: number): void {
    const numChannels = this.format.channels;
    const blockAlign = this.format.blockAlign;
    const is64Bit = bitsPerSample === 64;

    for (let i = 0; i < samples; i++) {
      const base = i * blockAlign;
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

  private decodeGenericPCM(
    view: DataView,
    samples: number,
    bytesPerSample: number,
    bitsPerSample: number,
  ): void {
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

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWavAudio {
    const { blockAlign, channels, sampleRate, bitDepth } = this.format;
    let samplesDecoded: number;
    const bps = this.bytesPerSample;

    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      const { samplesPerBlock } = this.format;
      if (!samplesPerBlock) {
        return this.createErrorResult('Missing samplesPerBlock for IMA ADPCM');
      }
      samplesDecoded = (frames.length / blockAlign) * samplesPerBlock;
    } else {
      samplesDecoded = frames.length / blockAlign;
    }

    if (
      this.channelData.length !== channels ||
      (this.channelData[0] && this.channelData[0].length < samplesDecoded)
    ) {
      this.channelData = Array.from({ length: channels }, () => new Float32Array(samplesDecoded));
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
      case WAVE_FORMAT_IMA_ADPCM: {
        const { samplesPerBlock } = this.format;
        const numBlocks = frames.length / blockAlign;

        for (let block = 0; block < numBlocks; block++) {
          const blockOffset = block * blockAlign;
          const headers: { predictor: number; stepIndex: number }[] = [];
          let headerOffset = blockOffset;

          for (let ch = 0; ch < channels; ch++) {
            headers.push({
              predictor: view.getInt16(headerOffset, this.isLittleEndian),
              stepIndex: view.getUint8(headerOffset + 2),
            });
            headerOffset += 4;
          }

          const compressedData = new Uint8Array(
            frames.buffer,
            frames.byteOffset + headerOffset,
            blockAlign - 4 * channels,
          );

          this.decodeImaAdpcmBlock(
            compressedData,
            headers,
            samplesPerBlock!,
            channels,
            this.channelData,
            block * samplesPerBlock!,
          );
        }
        break;
      }
      default:
        this.channelData.forEach((arr) => arr.fill(0));
    }

    const errors = [...this.errors];
    this.errors.length = 0;

    const outputBitDepth =
      this.formatTag === WAVE_FORMAT_IMA_ADPCM ? 16 : this.format.bitDepth || 0;

    return {
      bitDepth: outputBitDepth,
      channelData: this.channelData.map((arr) => arr.subarray(0, samplesDecoded)),
      errors,
      sampleRate,
      samplesDecoded,
    };
  }

  private decodePCM16Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    const isLE = this.isLittleEndian;
    for (let i = 0; i < samples; i++) {
      const offset = i * 2;
      mono[i] = view.getInt16(offset, isLE) * 0.000030517578125;
    }
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

  private getValidBitDepths(fmt: number): number[] {
    switch (fmt) {
      case WAVE_FORMAT_PCM:
        return [8, 16, 24, 32];
      case WAVE_FORMAT_IEEE_FLOAT:
        return [32, 64];
      case WAVE_FORMAT_ALAW:
      case WAVE_FORMAT_MULAW:
        return [8];
      case WAVE_FORMAT_IMA_ADPCM:
        return [4];
      default:
        return [];
    }
  }

  private parseFormatChunk(chunk: ChunkInfo, headerData: Uint8Array): void {
    const offset = chunk.offset + 8;
    const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.length);

    if (offset + 16 > headerData.length) {
      this.errors.push(this.createError('Format chunk too small'));
      return;
    }
    this.format = {
      bitDepth: view.getUint16(offset + 14, this.isLittleEndian),
      blockAlign: view.getUint16(offset + 12, this.isLittleEndian),
      bytesPerSecond: view.getUint32(offset + 8, this.isLittleEndian),
      channels: view.getUint16(offset + 2, this.isLittleEndian),
      formatTag: view.getUint16(offset, this.isLittleEndian),
      sampleRate: view.getUint32(offset + 4, this.isLittleEndian),
      samplesPerBlock: 0,
    };

    this.formatTag = this.format.formatTag;

    if (
      this.format.formatTag === WAVE_FORMAT_EXTENSIBLE &&
      chunk.size >= 40 &&
      offset + 40 <= headerData.length
    ) {
      this.format.channelMask = view.getUint32(offset + 20, this.isLittleEndian);
      this.format.extensionSize = view.getUint16(offset + 16, this.isLittleEndian);
      this.format.subFormat = headerData.subarray(offset + 24, offset + 40);
      this.format.validBitsPerSample = view.getUint16(offset + 18, this.isLittleEndian);
      this.formatTag = this.resolveExtensibleFormat();
    }

    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      this.bytesPerSample = 0;
      if (chunk.size >= 20) {
        const cbSize = view.getUint16(offset + 16, this.isLittleEndian);
        if (cbSize >= 2) {
          this.format.samplesPerBlock = view.getUint16(offset + 18, this.isLittleEndian);
        }
      }
    } else {
      this.bytesPerSample = this.format.bitDepth / 8;
    }
  }

  private processBufferedBlocks(): DecodedWavAudio {
    const { blockAlign } = this.format;
    if (
      this.state !== DecoderState.DECODING ||
      !blockAlign ||
      this.ringBuffer.available < blockAlign
    )
      return this.createEmptyResult();

    const blocks = Math.floor(this.ringBuffer.available / blockAlign);
    const bytes = blocks * blockAlign;

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

  private readAlaw(view: DataView, off: number): number {
    return ALAW_TABLE[view.getUint8(off)] ?? 0;
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

  private readMulaw(view: DataView, off: number): number {
    return MULAW_TABLE[view.getUint8(off)] ?? 0;
  }

  private readPcm(view: DataView, off: number, bits: number): number {
    switch (bits) {
      case 8:
        return (view.getUint8(off) - 128) * 0.0078125;
      case 16:
        return view.getInt16(off, this.isLittleEndian) * 0.000030517578125;
      case 24: {
        if (off + 3 > view.byteLength) return 0;
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

  private resolveExtensibleFormat(): number {
    const sf = this.format.subFormat;
    if (!sf) return this.format.formatTag;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
    return this.format.formatTag;
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

  private validateFormat(): boolean {
    if (this.format.bitDepth === 0 || this.format.channels === 0 || this.format.sampleRate === 0) {
      this.errors.push(this.createError('Invalid format: zero values in required fields'));
      return false;
    }
    if (this.format.channels > WavDecoder.MAX_CHANNELS) {
      this.errors.push(
        this.createError(
          `Too many channels: ${this.format.channels} (max ${WavDecoder.MAX_CHANNELS})`,
        ),
      );
      return false;
    }
    if (this.format.sampleRate > WavDecoder.MAX_SAMPLE_RATE) {
      this.errors.push(
        this.createError(
          `Sample rate too high: ${this.format.sampleRate} (max ${WavDecoder.MAX_SAMPLE_RATE})`,
        ),
      );
      return false;
    }
    if (!WavDecoder.supports(this.formatTag)) {
      this.errors.push(
        this.createError(`Unsupported audio format: 0x${this.formatTag.toString(16)}`),
      );
      return false;
    }

    const validBitDepths = this.getValidBitDepths(this.formatTag);
    if (!validBitDepths.includes(this.format.bitDepth)) {
      this.errors.push(
        this.createError(
          `Invalid bit depth: ${this.format.bitDepth} for format 0x${this.formatTag.toString(16)}`,
        ),
      );
      return false;
    }

    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      if (!this.format.samplesPerBlock || this.format.samplesPerBlock < 1) {
        this.errors.push(this.createError('Missing or invalid samplesPerBlock for IMA ADPCM'));
        return false;
      }

      const { channels, samplesPerBlock } = this.format;
      const expectedBlockAlign = 4 * channels + Math.ceil(((samplesPerBlock - 1) * channels) / 2);
      if (this.format.blockAlign !== expectedBlockAlign) {
        this.errors.push(
          this.createError(
            `Corrected invalid blockAlign for IMA ADPCM: was ${this.format.blockAlign}, now ${expectedBlockAlign}`,
          ),
        );
        this.format.blockAlign = expectedBlockAlign;
      }

      const expectedByteRate = Math.ceil(
        (this.format.sampleRate * this.format.blockAlign) / samplesPerBlock,
      );
      if (this.format.bytesPerSecond !== expectedByteRate) {
        this.errors.push(
          this.createError(
            `Corrected invalid byteRate for IMA ADPCM: was ${this.format.bytesPerSecond}, now ${expectedByteRate}`,
          ),
        );
        this.format.bytesPerSecond = expectedByteRate;
      }
    } else {
      const expectedBlockAlign = (this.format.bitDepth / 8) * this.format.channels;
      if (this.format.blockAlign !== expectedBlockAlign && expectedBlockAlign > 0) {
        this.errors.push(
          this.createError(
            `Corrected invalid blockAlign: header value was ${this.format.blockAlign}, but is now ${expectedBlockAlign}`,
          ),
        );
        this.format.blockAlign = expectedBlockAlign;
      }

      const expectedByteRate = this.format.sampleRate * this.format.blockAlign;
      if (this.format.bytesPerSecond !== expectedByteRate && expectedByteRate > 0) {
        this.errors.push(
          this.createError(
            `Corrected invalid byteRate: header value was ${this.format.bytesPerSecond}, but is now ${expectedByteRate}`,
          ),
        );
        this.format.bytesPerSecond = expectedByteRate;
      }
    }

    return true;
  }
}
