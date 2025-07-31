import {
  type ChunkInfo,
  type DecodedWavAudio,
  type DecodeError,
  type DecoderOptions,
  DecoderState,
  type AudioDecoder,
  type WavFormat,
} from './types';
import { RingBuffer } from './RingBuffer';

function decodePCM8Mono_unrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = 1 / 128;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = (input[i]! - 128) * k;
    out[i + 1] = (input[i + 1]! - 128) * k;
    out[i + 2] = (input[i + 2]! - 128) * k;
    out[i + 3] = (input[i + 3]! - 128) * k;
  }
  for (; i < frames; ++i) out[i] = (input[i]! - 128) * k;
}

function decodePCM8Stereo_unrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 128;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = (input[j]! - 128) * k;
    right[i] = (input[j + 1]! - 128) * k;
    left[i + 1] = (input[j + 2]! - 128) * k;
    right[i + 1] = (input[j + 3]! - 128) * k;
    left[i + 2] = (input[j + 4]! - 128) * k;
    right[i + 2] = (input[j + 5]! - 128) * k;
    left[i + 3] = (input[j + 6]! - 128) * k;
    right[i + 3] = (input[j + 7]! - 128) * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = (input[j]! - 128) * k;
    right[i] = (input[j + 1]! - 128) * k;
  }
}

function decodePCM16Mono_unrolled(input: Int16Array, out: Float32Array, frames: number): void {
  const k = 1 / 32768;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]! * k;
    out[i + 1] = input[i + 1]! * k;
    out[i + 2] = input[i + 2]! * k;
    out[i + 3] = input[i + 3]! * k;
  }
  for (; i < frames; ++i) out[i] = input[i]! * k;
}

function decodePCM16Stereo_unrolled(input: Int16Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 32768;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
    left[i + 1] = input[j + 2]! * k;
    right[i + 1] = input[j + 3]! * k;
    left[i + 2] = input[j + 4]! * k;
    right[i + 2] = input[j + 5]! * k;
    left[i + 3] = input[j + 6]! * k;
    right[i + 3] = input[j + 7]! * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
  }
}

function decodePCM24Mono_unrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = 1 / 8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 12) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 3;
      let v = (input[o + 2]! << 16) | (input[o + 1]! << 8) | input[o]!;
      v = (v << 8) >> 8;
      out[i + u] = v * k;
    }
  }
  for (; i < frames; ++i, ofs += 3) {
    let v = (input[ofs + 2]! << 16) | (input[ofs + 1]! << 8) | input[ofs]!;
    v = (v << 8) >> 8;
    out[i] = v * k;
  }
}

function decodePCM24Stereo_unrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 24) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 6;
      let lv = (input[o + 2]! << 16) | (input[o + 1]! << 8) | input[o]!;
      lv = (lv << 8) >> 8;
      left[i + u] = lv * k;
      let rv = (input[o + 5]! << 16) | (input[o + 4]! << 8) | input[o + 3]!;
      rv = (rv << 8) >> 8;
      right[i + u] = rv * k;
    }
  }
  for (; i < frames; ++i, ofs += 6) {
    let lv = (input[ofs + 2]! << 16) | (input[ofs + 1]! << 8) | input[ofs]!;
    lv = (lv << 8) >> 8;
    left[i] = lv * k;
    let rv = (input[ofs + 5]! << 16) | (input[ofs + 4]! << 8) | input[ofs + 3]!;
    rv = (rv << 8) >> 8;
    right[i] = rv * k;
  }
}

function decodePCM32Mono_unrolled(input: Int32Array, out: Float32Array, frames: number): void {
  const k = 1 / 2147483648;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]! * k;
    out[i + 1] = input[i + 1]! * k;
    out[i + 2] = input[i + 2]! * k;
    out[i + 3] = input[i + 3]! * k;
  }
  for (; i < frames; ++i) out[i] = input[i]! * k;
}

function decodePCM32Stereo_unrolled(input: Int32Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 2147483648;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
    left[i + 1] = input[j + 2]! * k;
    right[i + 1] = input[j + 3]! * k;
    left[i + 2] = input[j + 4]! * k;
    right[i + 2] = input[j + 5]! * k;
    left[i + 3] = input[j + 6]! * k;
    right[i + 3] = input[j + 7]! * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
  }
}

function decodeFloat32Mono_unrolled(input: Float32Array, out: Float32Array, frames: number): void {
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]!;
    out[i + 1] = input[i + 1]!;
    out[i + 2] = input[i + 2]!;
    out[i + 3] = input[i + 3]!;
  }
  for (; i < frames; ++i) out[i] = input[i]!;
}

function decodeFloat32Stereo_unrolled(
  input: Float32Array,
  left: Float32Array,
  right: Float32Array,
  frames: number
): void {
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]!;
    right[i] = input[j + 1]!;
    left[i + 1] = input[j + 2]!;
    right[i + 1] = input[j + 3]!;
    left[i + 2] = input[j + 4]!;
    right[i + 2] = input[j + 5]!;
    left[i + 3] = input[j + 6]!;
    right[i + 3] = input[j + 7]!;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]!;
    right[i] = input[j + 1]!;
  }
}

const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IMA_ADPCM = 0x0011;

const INV_128 = 1 / 128;
const INV_32768 = 1 / 32768;
const INV_8388608 = 1 / 8388608;
const INV_2147483648 = 1 / 2147483648;

const ID_RIFF = 0x52494646;
const ID_RIFX = 0x52494658;
const ID_WAVE = 0x57415645;
const ID_FMT = 0x666d7420;
const ID_DATA = 0x64617461;
const ID_FACT = 0x66616374;

const imaStepTable = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
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
    table[i] = sign * sample * INV_32768;
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
    table[i] = sign * sample * INV_32768;
  }
  return table;
})();

export class WavDecoder implements AudioDecoder {
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_CHANNELS = 32;
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;

  private bytesPerSample = 0;
  private channelData: Float32Array[] = [];
  private decodeBuffer: ArrayBuffer;
  private scratchPool: ArrayBuffer[] = [];
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
  private errorTemplate: DecodeError = {
    frameLength: 0,
    frameNumber: 0,
    inputBytes: 0,
    message: '',
    outputSamples: 0,
  };

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);
    this.decodeBuffer = this.getScratchBuffer(4096);
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
      parsedChunks: [...this.parsedChunks],
      remainingBytes: this.remainingBytes,
      state: this.state,
      totalBytes: this.totalBytes,
      unhandledChunks: [...this.unhandledChunks],
    };
  }

  get progress(): number {
    return this.totalBytes > 0 ? this.decodedBytes / this.totalBytes : 0;
  }

  get totalDuration(): number {
    return this.estimatedSamples / (this.format.sampleRate || 1);
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
            bitsPerSample: this.format.bitsPerSample,
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
    const { channels, bitsPerSample } = this.format;
    const output = new Float32Array(channels);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);
    const bytesPerSample = bitsPerSample / 8;
    for (let ch = 0; ch < channels; ch++) {
      const offset = ch * bytesPerSample;
      output[ch] = this.readSample(view, offset, bitsPerSample, this.formatTag);
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
        bitsPerSample: this.format.bitsPerSample || 0,
        channelData: [],
        errors: finalErrors,
        sampleRate: this.format.sampleRate || 0,
        samplesDecoded: 0,
      };
    }
  }

  public free(): void {
    this.releaseScratchBuffer(this.decodeBuffer);
    this.scratchPool = [];
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

  private getScratchBuffer(size: number): ArrayBuffer {
    if (this.scratchPool.length > 0) {
      const buf = this.scratchPool.pop()!;
      if (buf.byteLength >= size) {
        return buf;
      }
    }
    return new ArrayBuffer(size);
  }

  private releaseScratchBuffer(buf: ArrayBuffer): void {
    this.scratchPool.push(buf);
  }

  private initChannelData(channels: number, samples: number): void {
    if (this.channelData.length === channels && this.channelData[0]!.length >= samples) {
      return;
    }
    this.channelData = Array.from({ length: channels }, () => new Float32Array(samples));
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private createError(message: string): DecodeError {
    const blockSize = this.format.blockAlign ?? 0;
    const error = { ...this.errorTemplate };
    error.frameLength = blockSize;
    error.frameNumber = blockSize > 0 ? Math.floor(this.decodedBytes / blockSize) : 0;
    error.inputBytes = this.decodedBytes;
    error.message = message;
    error.outputSamples = this.estimatedSamples;
    return error;
  }

  private createEmptyResult(): DecodedWavAudio {
    const errors = [...this.errors];
    this.errors.length = 0;
    return {
      bitsPerSample: this.format.bitsPerSample,
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
    outputOffset: number
  ): void {
    const predictors = headers.map((h) => h.predictor);
    const stepIndices = headers.map((h) => Math.min(88, Math.max(0, h.stepIndex)));

    for (let ch = 0; ch < channels; ch++) {
      this.channelData[ch]![outputOffset] = predictors[ch]! * INV_32768;
    }

    let sampleIndex = 1;
    let nibbleIndex = 0;
    const processNibble = (nibble: number, ch: number) => {
      const step = imaStepTable[stepIndices[ch]!]!;
      let diff = step >> 3;
      if (nibble & 1) diff += step >> 2;
      if (nibble & 2) diff += step >> 1;
      if (nibble & 4) diff += step;
      if (nibble & 8) diff = -diff;

      predictors[ch]! += diff;
      predictors[ch] = Math.max(-32768, Math.min(32767, predictors[ch]!));
      stepIndices[ch] = Math.min(88, Math.max(0, stepIndices[ch]! + imaIndexAdjustTable[nibble]!));

      this.channelData[ch]![outputOffset + sampleIndex] = predictors[ch]! * INV_32768;
    };

    for (let i = 0; i < compressed.length; i++) {
      const byte = compressed[i]!;
      const lowNibble = byte & 0x0f;
      const highNibble = byte >> 4;

      const ch1 = nibbleIndex % channels;
      processNibble(lowNibble, ch1);
      if (ch1 === channels - 1) sampleIndex++;
      nibbleIndex++;
      if (sampleIndex >= samplesPerBlock) break;

      const ch2 = nibbleIndex % channels;
      processNibble(highNibble, ch2);
      if (ch2 === channels - 1) sampleIndex++;
      nibbleIndex++;
      if (sampleIndex >= samplesPerBlock) break;
    }
  }

  private decodeCompressed(view: DataView, samples: number): void {
    const numChannels = this.format.channels;
    const blockSize = this.format.blockAlign;
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

  private decodeFloat(view: DataView, samples: number, bps: number, bitsPerSample: number): void {
    const numChannels = this.format.channels;
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

  private decodeFloat32Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    if (this.isLittleEndian) {
      decodeFloat32Mono_unrolled(new Float32Array(view.buffer, view.byteOffset, samples), mono, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        mono[i] = Math.max(-1, Math.min(1, view.getFloat32(i * 4, false)));
      }
    }
  }

  private decodeFloat32Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    if (this.isLittleEndian) {
      decodeFloat32Stereo_unrolled(new Float32Array(view.buffer, view.byteOffset, samples * 2), left, right, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        const offset = i * 8;
        left[i] = Math.max(-1, Math.min(1, view.getFloat32(offset, false)));
        right[i] = Math.max(-1, Math.min(1, view.getFloat32(offset + 4, false)));
      }
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

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWavAudio {
    const { blockAlign, channels, sampleRate, bitsPerSample } = this.format;
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

    this.initChannelData(channels, samplesDecoded);

    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);

    switch (this.formatTag) {
      case WAVE_FORMAT_PCM: {
        if (channels === 1 && bitsPerSample === 8) this.decodePCM8Mono(view, samplesDecoded);
        else if (channels === 2 && bitsPerSample === 8) this.decodePCM8Stereo(view, samplesDecoded);
        else if (channels === 1 && bitsPerSample === 16) this.decodePCM16Mono(view, samplesDecoded);
        else if (channels === 2 && bitsPerSample === 16) this.decodePCM16Stereo(view, samplesDecoded);
        else if (channels === 1 && bitsPerSample === 24) this.decodePCM24Mono(view, samplesDecoded);
        else if (channels === 2 && bitsPerSample === 24) this.decodePCM24Stereo(view, samplesDecoded);
        else if (channels === 1 && bitsPerSample === 32) this.decodePCM32Mono(view, samplesDecoded);
        else if (channels === 2 && bitsPerSample === 32) this.decodePCM32Stereo(view, samplesDecoded);
        else this.decodeGenericPCM(view, samplesDecoded, bps, bitsPerSample);
        break;
      }
      case WAVE_FORMAT_IEEE_FLOAT: {
        if (channels === 1 && bitsPerSample === 32) this.decodeFloat32Mono(view, samplesDecoded);
        else if (channels === 2 && bitsPerSample === 32) this.decodeFloat32Stereo(view, samplesDecoded);
        else this.decodeFloat(view, samplesDecoded, bps, bitsPerSample);
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
            blockAlign - 4 * channels
          );

          this.decodeImaAdpcmBlock(compressedData, headers, samplesPerBlock!, channels, block * samplesPerBlock!);
        }
        break;
      }
      default:
        this.channelData.forEach((arr) => arr.fill(0));
    }

    const outputBitDepth = this.formatTag === WAVE_FORMAT_IMA_ADPCM ? 16 : this.format.bitsPerSample;
    const channelData = this.channelData.map((arr) => arr.subarray(0, samplesDecoded));

    const errors = [...this.errors];
    this.errors.length = 0;

    return {
      bitsPerSample: outputBitDepth,
      channelData,
      errors,
      sampleRate,
      samplesDecoded,
    };
  }

  private decodePCM8Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    const input = new Uint8Array(view.buffer, view.byteOffset, samples);
    decodePCM8Mono_unrolled(input, mono, samples);
  }

  private decodePCM8Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const input = new Uint8Array(view.buffer, view.byteOffset, samples * 2);
    decodePCM8Stereo_unrolled(input, left, right, samples);
  }

  private decodePCM16Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    if (this.isLittleEndian) {
      const input = new Int16Array(view.buffer, view.byteOffset, samples);
      decodePCM16Mono_unrolled(input, mono, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        mono[i] = view.getInt16(i * 2, false) * INV_32768;
      }
    }
  }

  private decodePCM16Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    if (this.isLittleEndian) {
      const input = new Int16Array(view.buffer, view.byteOffset, samples * 2);
      decodePCM16Stereo_unrolled(input, left, right, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        const offset = i * 4;
        left[i] = view.getInt16(offset, false) * INV_32768;
        right[i] = view.getInt16(offset + 2, false) * INV_32768;
      }
    }
  }

  private decodePCM24Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    const input = new Uint8Array(view.buffer, view.byteOffset, samples * 3);
    if (this.isLittleEndian) {
      decodePCM24Mono_unrolled(input, mono, samples);
    } else {
      const k = 1 / 8388608;
      let offset = 0;
      for (let i = 0; i < samples; i++) {
        let val = (input[offset]! << 16) | (input[offset + 1]! << 8) | input[offset + 2]!;
        val = (val << 8) >> 8;
        mono[i] = val * k;
        offset += 3;
      }
    }
  }

  private decodePCM24Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    const input = new Uint8Array(view.buffer, view.byteOffset, samples * 6);
    if (this.isLittleEndian) {
      decodePCM24Stereo_unrolled(input, left, right, samples);
    } else {
      const k = 1 / 8388608;
      let offset = 0;
      for (let i = 0; i < samples; i++) {
        let lv = (input[offset]! << 16) | (input[offset + 1]! << 8) | input[offset + 2]!;
        lv = (lv << 8) >> 8;
        left[i] = lv * k;
        offset += 3;

        let rv = (input[offset]! << 16) | (input[offset + 1]! << 8) | input[offset + 2]!;
        rv = (rv << 8) >> 8;
        right[i] = rv * k;
        offset += 3;
      }
    }
  }

  private decodePCM32Mono(view: DataView, samples: number): void {
    const mono = this.channelData[0]!;
    if (this.isLittleEndian) {
      const input = new Int32Array(view.buffer, view.byteOffset, samples);
      decodePCM32Mono_unrolled(input, mono, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        mono[i] = view.getInt32(i * 4, false) * INV_2147483648;
      }
    }
  }

  private decodePCM32Stereo(view: DataView, samples: number): void {
    const left = this.channelData[0]!;
    const right = this.channelData[1]!;
    if (this.isLittleEndian) {
      const input = new Int32Array(view.buffer, view.byteOffset, samples * 2);
      decodePCM32Stereo_unrolled(input, left, right, samples);
    } else {
      for (let i = 0; i < samples; i++) {
        const offset = i * 8;
        left[i] = view.getInt32(offset, false) * INV_2147483648;
        right[i] = view.getInt32(offset + 4, false) * INV_2147483648;
      }
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
      bitsPerSample: view.getUint16(offset + 14, this.isLittleEndian),
      blockAlign: view.getUint16(offset + 12, this.isLittleEndian),
      bytesPerSecond: view.getUint32(offset + 8, this.isLittleEndian),
      channels: view.getUint16(offset + 2, this.isLittleEndian),
      formatTag: view.getUint16(offset, this.isLittleEndian),
      sampleRate: view.getUint32(offset + 4, this.isLittleEndian),
    };

    this.formatTag = this.format.formatTag;

    if (this.format.formatTag === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40 && offset + 40 <= headerData.length) {
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
      this.bytesPerSample = this.format.bitsPerSample / 8;
    }
  }

  private processBufferedBlocks(): DecodedWavAudio {
    const { blockAlign } = this.format;
    if (this.state !== DecoderState.DECODING || !blockAlign || this.ringBuffer.available < blockAlign)
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
      this.releaseScratchBuffer(this.decodeBuffer);
      this.decodeBuffer = this.getScratchBuffer(bytes);
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
        return (view.getUint8(off) - 128) * INV_128;
      case 16:
        return view.getInt16(off, this.isLittleEndian) * INV_32768;
      case 24: {
        if (off + 3 > view.byteLength) return 0;
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let val = this.isLittleEndian ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        val = (val << 8) >> 8;
        return val * INV_8388608;
      }
      case 32:
        return view.getInt32(off, this.isLittleEndian) * INV_2147483648;
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

    const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength);
    const getUint32 = (off: number) => view.getUint32(off, this.isLittleEndian);
    const getUint32BE = (off: number) => view.getUint32(off, false);

    const riffTag = getUint32BE(0);
    if (riffTag !== ID_RIFF && riffTag !== ID_RIFX) {
      this.state = DecoderState.ERROR;
      this.errors.push(this.createError('Invalid WAV file: missing RIFF/RIFX tag'));
      return false;
    }
    this.isLittleEndian = riffTag === ID_RIFF;

    if (getUint32BE(8) !== ID_WAVE) {
      this.state = DecoderState.ERROR;
      this.errors.push(this.createError('Invalid WAV file: missing WAVE tag'));
      return false;
    }

    let offset = 12;
    let fmtChunk: ChunkInfo | null = null;
    let dataChunk: ChunkInfo | null = null;
    const parsedChunks: ChunkInfo[] = [];

    while (offset + 8 <= headerData.length) {
      const id = getUint32BE(offset);
      const size = getUint32(offset + 4);

      if (id === ID_DATA) {
        dataChunk = { id: 'data', size, offset };
        parsedChunks.push(dataChunk);
        break;
      }

      const chunkEnd = offset + 8 + size + (size % 2);
      if (chunkEnd > headerData.length) return false;

      let idStr = '';
      if (id === ID_FMT) idStr = 'fmt ';
      else if (id === ID_FACT) idStr = 'fact';

      const chunkInfo = { id: idStr, size, offset };
      parsedChunks.push(chunkInfo);
      if (id === ID_FMT) fmtChunk = chunkInfo;
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
    if (this.format.bitsPerSample === 0 || this.format.channels === 0 || this.format.sampleRate === 0) {
      this.errors.push(this.createError('Invalid format: zero values in required fields'));
      return false;
    }
    if (this.format.channels > WavDecoder.MAX_CHANNELS) {
      this.errors.push(this.createError(`Too many channels: ${this.format.channels} (max ${WavDecoder.MAX_CHANNELS})`));
      return false;
    }
    if (this.format.sampleRate > WavDecoder.MAX_SAMPLE_RATE) {
      this.errors.push(
        this.createError(`Sample rate too high: ${this.format.sampleRate} (max ${WavDecoder.MAX_SAMPLE_RATE})`)
      );
      return false;
    }
    if (!WavDecoder.supports(this.formatTag)) {
      this.errors.push(this.createError(`Unsupported audio format: 0x${this.formatTag.toString(16)}`));
      return false;
    }

    const validBitDepths = this.getValidBitDepths(this.formatTag);
    if (!validBitDepths.includes(this.format.bitsPerSample)) {
      this.errors.push(
        this.createError(`Invalid bit depth: ${this.format.bitsPerSample} for format 0x${this.formatTag.toString(16)}`)
      );
      return false;
    }

    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      if (!this.format.samplesPerBlock || this.format.samplesPerBlock < 1) {
        this.errors.push(this.createError('Missing or invalid samplesPerBlock for IMA ADPCM'));
        return false;
      }

      const { channels, samplesPerBlock } = this.format;
      const expectedBlockSize = 4 * channels + Math.ceil(((samplesPerBlock - 1) * channels) / 2);
      if (this.format.blockAlign !== expectedBlockSize) {
        this.errors.push(
          this.createError(
            `Corrected invalid blockAlign for IMA ADPCM: was ${this.format.blockAlign}, now ${expectedBlockSize}`
          )
        );
        this.format.blockAlign = expectedBlockSize;
      }

      const expectedByteRate = Math.ceil((this.format.sampleRate * this.format.blockAlign) / samplesPerBlock);
      if (this.format.bytesPerSecond !== expectedByteRate) {
        this.errors.push(
          this.createError(
            `Corrected invalid byteRate for IMA ADPCM: was ${this.format.bytesPerSecond}, now ${expectedByteRate}`
          )
        );
        this.format.bytesPerSecond = expectedByteRate;
      }
    } else {
      const expectedBlockAlign = (this.format.bitsPerSample / 8) * this.format.channels;
      if (this.format.blockAlign !== expectedBlockAlign && expectedBlockAlign > 0) {
        this.errors.push(
          this.createError(
            `Corrected invalid blockAlign: header value was ${this.format.blockAlign}, but is now ${expectedBlockAlign}`
          )
        );
        this.format.blockAlign = expectedBlockAlign;
      }

      const expectedByteRate = this.format.sampleRate * this.format.blockAlign;
      if (this.format.bytesPerSecond !== expectedByteRate && expectedByteRate > 0) {
        this.errors.push(
          this.createError(
            `Corrected invalid byteRate: header value was ${this.format.bytesPerSecond}, but is now ${expectedByteRate}`
          )
        );
        this.format.bytesPerSecond = expectedByteRate;
      }
    }

    return true;
  }
}
