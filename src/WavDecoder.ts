import {
  type ChunkInfo,
  type DecodedWavAudio,
  type DecodeError,
  type DecoderOptions,
  DecoderState,
  type WavDecoderInterface,
  type WavFormat,
} from './types';
import { RingBuffer } from './RingBuffer';
import {
  decodeAlaw,
  decodeAlawN,
  decodeAlawStereo,
  decodeFloat32Mono,
  decodeFloat32N,
  decodeFloat32Stereo,
  decodeFloat64Mono,
  decodeFloat64N,
  decodeFloat64Stereo,
  decodeMulaw,
  decodeMulawN,
  decodeMulawStereo,
  decodePCM16Mono,
  decodePCM16N,
  decodePCM16Stereo,
  decodePCM24Mono,
  decodePCM24N,
  decodePCM24Stereo,
  decodePCM32Mono,
  decodePCM32N,
  decodePCM32Stereo,
  decodePCM8Mono,
  decodePCM8N,
  decodePCM8Stereo,
} from './utils';

const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IMA_ADPCM = 0x0011;

// Precomputed constants for optimized math
const SCALE_8 = 1 / 128;
const SCALE_16 = 1 / 32768;
const SCALE_24 = 1 / 8388608;
const SCALE_32 = 1 / 2147483648;

// Branchless clamp helper
const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

const imaStepTable = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);
const imaIndexAdjustTable = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Uint8Array([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);
const KSDATAFORMAT_SUBTYPE_PCM = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export class WavDecoder implements WavDecoderInterface {
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;
  private static readonly MAX_CHANNELS = 32;

  private bytesPerSample!: number;
  private channelData!: Float32Array[];
  private decodeBuffer!: ArrayBuffer;
  private decodedBytes!: number;
  private errors!: DecodeError[];
  private factChunkSamples!: number;
  private format!: WavFormat;
  private formatTag!: number;
  private headerBuffer!: Uint8Array;
  private isLittleEndian!: boolean;
  private parsedChunks!: ChunkInfo[];
  private remainingBytes!: number;
  private ringBuffer!: RingBuffer;
  private state!: DecoderState;
  private totalBytes!: number;
  private unhandledChunks!: ChunkInfo[];

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.maxBufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);
    this.decodeBuffer = new ArrayBuffer(4096);
    this.reset();
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

  public reset(): void {
    this.state = DecoderState.UNINIT;
    this.format = {
      formatTag: 0,
      channels: 0,
      sampleRate: 0,
      bitDepth: 0,
      blockSize: 0,
      bytesPerSecond: 0,
      samplesPerBlock: 0,
      channelMask: 0,
      extensionSize: 0,
      subFormat: new Uint8Array(),
      validBitsPerSample: 0,
    };
    this.bytesPerSample = 0;
    this.channelData = [];
    this.decodedBytes = 0;
    this.errors = [];
    this.factChunkSamples = 0;
    this.formatTag = 0;
    this.headerBuffer = new Uint8Array(0);
    this.isLittleEndian = true;
    this.parsedChunks = [];
    this.unhandledChunks = [];
    this.remainingBytes = 0;
    this.totalBytes = 0;
  }

  public get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockSize > 0) {
      if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
        const blocks = Math.floor(this.totalBytes / this.format.blockSize);
        return blocks * (this.format.samplesPerBlock ?? 0);
      }
      return Math.floor(this.totalBytes / this.bytesPerSample / this.format.channels);
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

  public decodeFrame(frame: Uint8Array): Float32Array {
    const { channels, bitDepth, samplesPerBlock, blockSize } = this.format;
    const output = Array.from({ length: channels }, () => new Float32Array(1));
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);

    try {
      switch (this.formatTag) {
        case WAVE_FORMAT_PCM:
          if (bitDepth === 8) {
            decodePCM8N(frame, output);
          } else if (bitDepth === 16) {
            decodePCM16N(view, output, this.isLittleEndian);
          } else if (bitDepth === 24) {
            decodePCM24N(frame, output, this.isLittleEndian);
          } else if (bitDepth === 32) {
            decodePCM32N(view, output, this.isLittleEndian);
          } else {
            this.errors.push(this.createError(`Unsupported PCM bit depth: ${bitDepth}`));
          }
          break;

        case WAVE_FORMAT_IEEE_FLOAT:
          if (bitDepth === 32) {
            decodeFloat32N(view, output, this.isLittleEndian);
          } else if (bitDepth === 64) {
            decodeFloat64N(view, output, this.isLittleEndian);
          } else {
            this.errors.push(this.createError(`Unsupported float bit depth: ${bitDepth}`));
          }
          break;

        case WAVE_FORMAT_ALAW:
          if (channels === 1) {
            decodeAlaw(frame, output[0]);
          } else if (channels === 2) {
            decodeAlawStereo(frame, output[0], output[1]);
          } else {
            decodeAlawN(frame, output);
          }
          break;

        case WAVE_FORMAT_MULAW:
          if (channels === 1) {
            decodeMulaw(frame, output[0]);
          } else if (channels === 2) {
            decodeMulawStereo(frame, output[0], output[1]);
          } else {
            decodeMulawN(frame, output);
          }
          break;

        case WAVE_FORMAT_IMA_ADPCM:
          if (!samplesPerBlock || frame.length !== blockSize) {
            this.errors.push(this.createError('Invalid IMA ADPCM frame size'));
          } else {
            let headerOffset = 0;
            for (let ch = 0; ch < channels; ch++) {
              const predictor = view.getInt16(headerOffset, this.isLittleEndian);
              output[ch][0] = clamp1(predictor * SCALE_16);
              headerOffset += 4;
            }
          }
          break;

        default:
          this.errors.push(
            this.createError(`Unsupported formatTag: 0x${this.formatTag.toString(16)}`),
          );
      }
    } catch (error) {
      this.errors.push(
        this.createError(`Decode error: ${error instanceof Error ? error.message : String(error)}`),
      );
    }

    return new Float32Array(output.map((ch) => ch[0]));
  }

  public async *decodeStream(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterableIterator<DecodedWavAudio> {
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

  public flush(): DecodedWavAudio {
    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createEmptyResult();
    }
    const bufferedBlocks = this.processBufferedBlocks();
    const leftoverBytes = this.ringBuffer.available;
    if (leftoverBytes > 0) {
      const error = this.createError(`Discarded ${leftoverBytes} bytes of incomplete final block.`);
      this.errors.push(error);
      this.remainingBytes = Math.max(0, this.remainingBytes - leftoverBytes);
      this.ringBuffer.clear();
    }
    this.state = DecoderState.ENDED;
    const errors = [...bufferedBlocks.errors, ...this.errors];
    this.errors.length = 0;
    if (bufferedBlocks.samplesDecoded > 0) {
      return {
        ...bufferedBlocks,
        errors,
      };
    } else {
      return {
        bitDepth: this.format.bitDepth || 0,
        channelData: [],
        errors: errors,
        sampleRate: this.format.sampleRate || 0,
        samplesDecoded: 0,
      };
    }
  }

  public free(): void {
    this.reset();
    this.state = DecoderState.ENDED;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private createError(message: string): DecodeError {
    const blockSize = this.format.blockSize ?? 0;
    return {
      frameLength: blockSize,
      frameNumber: blockSize > 0 ? Math.floor(this.decodedBytes / blockSize) : 0,
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
      channelData[ch][outputOffset] = clamp1(predictors[ch] * SCALE_16);
    }

    for (let s = 1; s < samplesPerBlock; s++) {
      for (let ch = 0; ch < channels; ch++) {
        const nibbleIndex = (s - 1) * channels + ch;
        const byteIndex = nibbleIndex >>> 1;
        const shift = nibbleIndex & 1 ? 4 : 0;
        const nibble = (compressed[byteIndex] >> shift) & 0x0f;

        const step = imaStepTable[stepIndices[ch]];

        let diff = step >> 3;
        if (nibble & 1) diff += step >> 2;
        if (nibble & 2) diff += step >> 1;
        if (nibble & 4) diff += step;
        if (nibble & 8) diff = -diff;

        predictors[ch] += diff;
        predictors[ch] = Math.max(-32768, Math.min(32767, predictors[ch]));
        stepIndices[ch] = Math.min(88, Math.max(0, stepIndices[ch] + imaIndexAdjustTable[nibble]));

        channelData[ch][outputOffset + s] = clamp1(predictors[ch] * SCALE_16);
      }
    }
  }

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWavAudio {
    const { blockSize, channels, sampleRate, bitDepth } = this.format;
    let samplesDecoded: number;

    if (this.formatTag === WAVE_FORMAT_IMA_ADPCM) {
      const { samplesPerBlock } = this.format;
      if (!samplesPerBlock) {
        return this.createErrorResult('Missing samplesPerBlock for IMA ADPCM');
      }
      samplesDecoded = (frames.length / blockSize) * samplesPerBlock;
    } else {
      samplesDecoded = frames.length / blockSize;
    }

    if (
      this.channelData.length !== channels ||
      (this.channelData[0] && this.channelData[0].length < samplesDecoded)
    ) {
      this.channelData = Array.from({ length: channels }, () => new Float32Array(samplesDecoded));
    }

    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
    const bytes = new Uint8Array(frames.buffer, frames.byteOffset, frames.length);

    switch (this.formatTag) {
      case WAVE_FORMAT_PCM: {
        if (channels === 1) {
          if (bitDepth === 8) {
            decodePCM8Mono(bytes, this.channelData[0]);
          } else if (bitDepth === 16) {
            decodePCM16Mono(view, this.channelData[0], this.isLittleEndian);
          } else if (bitDepth === 24) {
            decodePCM24Mono(bytes, this.channelData[0], this.isLittleEndian);
          } else if (bitDepth === 32) {
            decodePCM32Mono(view, this.channelData[0], this.isLittleEndian);
          }
        } else if (channels === 2) {
          if (bitDepth === 8) {
            decodePCM8Stereo(bytes, this.channelData[0], this.channelData[1]);
          } else if (bitDepth === 16) {
            decodePCM16Stereo(view, this.channelData[0], this.channelData[1], this.isLittleEndian);
          } else if (bitDepth === 24) {
            decodePCM24Stereo(bytes, this.channelData[0], this.channelData[1], this.isLittleEndian);
          } else if (bitDepth === 32) {
            decodePCM32Stereo(view, this.channelData[0], this.channelData[1], this.isLittleEndian);
          }
        } else {
          if (bitDepth === 8) decodePCM8N(bytes, this.channelData);
          else if (bitDepth === 16) decodePCM16N(view, this.channelData, this.isLittleEndian);
          else if (bitDepth === 24) decodePCM24N(bytes, this.channelData, this.isLittleEndian);
          else if (bitDepth === 32) decodePCM32N(view, this.channelData, this.isLittleEndian);
        }
        break;
      }
      case WAVE_FORMAT_IEEE_FLOAT: {
        if (channels === 1) {
          if (bitDepth === 32) decodeFloat32Mono(view, this.channelData[0], this.isLittleEndian);
          else if (bitDepth === 64)
            decodeFloat64Mono(view, this.channelData[0], this.isLittleEndian);
        } else if (channels === 2) {
          if (bitDepth === 32)
            decodeFloat32Stereo(
              view,
              this.channelData[0],
              this.channelData[1],
              this.isLittleEndian,
            );
          else if (bitDepth === 64)
            decodeFloat64Stereo(
              view,
              this.channelData[0],
              this.channelData[1],
              this.isLittleEndian,
            );
        } else {
          if (bitDepth === 32) decodeFloat32N(view, this.channelData, this.isLittleEndian);
          else if (bitDepth === 64) decodeFloat64N(view, this.channelData, this.isLittleEndian);
        }
        break;
      }
      case WAVE_FORMAT_ALAW: {
        decodeAlawN(bytes, this.channelData);
        break;
      }
      case WAVE_FORMAT_MULAW: {
        decodeMulawN(bytes, this.channelData);
        break;
      }
      case WAVE_FORMAT_IMA_ADPCM: {
        const { samplesPerBlock } = this.format;
        const numBlocks = frames.length / blockSize;

        for (let block = 0; block < numBlocks; block++) {
          const blockOffset = block * blockSize;
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
            blockSize - 4 * channels,
          );

          this.decodeImaAdpcmBlock(
            compressedData,
            headers,
            samplesPerBlock,
            channels,
            this.channelData,
            block * samplesPerBlock,
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
      blockSize: view.getUint16(offset + 12, this.isLittleEndian),
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
      const expectedBlockSize = 4 * channels + Math.ceil(((samplesPerBlock - 1) * channels) / 2);
      if (this.format.blockSize !== expectedBlockSize) {
        this.errors.push(
          this.createError(
            `Corrected invalid blockAlign for IMA ADPCM: was ${this.format.blockSize}, now ${expectedBlockSize}`,
          ),
        );
        this.format.blockSize = expectedBlockSize;
      }

      const expectedByteRate = Math.ceil(
        (this.format.sampleRate * this.format.blockSize) / samplesPerBlock,
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
    }

    return true;
  }
}
