import {
  type AudioDecoder,
  type DataChunk,
  type DecodedWavAudio,
  type DecodeError,
  type DecoderOptions,
  DecoderState,
  type ExtendedWavFormat,
  type WavDecoderInfo,
} from './types';

import { RingBuffer } from './RingBuffer';
import { parseWavHeader } from './parseWavHeader';
import {
  decodeFloat32Mono,
  decodeFloat32Stereo,
  decodePCM16Mono,
  decodePCM16Stereo,
  decodePCM24Mono,
  decodePCM24Stereo,
  decodePCM32Mono,
  decodePCM32Stereo,
  decodePCM8Mono,
  decodePCM8Stereo,
} from './decode-fns';
import {
  ALAW_TABLE,
  IMA_INDEX_ADJUST_TABLE,
  IMA_STEP_TABLE,
  INV_128,
  INV_2147483648,
  INV_32768,
  INV_8388608,
  KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
  KSDATAFORMAT_SUBTYPE_PCM,
  MULAW_TABLE,
  WAVE_FORMAT_ALAW,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_FORMAT_MULAW,
  WAVE_FORMAT_PCM,
} from './constants';

interface ErrorCollector {
  errors: DecodeError[];
}

export class WavDecoder implements AudioDecoder {
  private static readonly MAX_BUFFER_SIZE = 16 * 1024 * 1024;
  private static readonly MAX_CHANNELS = 32;
  private static readonly MAX_HEADER_SIZE = 2 * 1024 * 1024;
  private static readonly MAX_SAMPLE_RATE = 384000;

  private state = DecoderState.IDLE;
  private format: ExtendedWavFormat = {} as ExtendedWavFormat;

  private decodedBytes = 0;
  private totalBytes = 0;
  private remainingBytes = 0;

  private ringBuffer: RingBuffer;
  private headerBuffer = new Uint8Array(0);
  private channelData: Float32Array[] = [];
  private decodeBuffer: ArrayBuffer;
  private scratchPool: ArrayBuffer[] = [];
  private parsedChunks: DataChunk[] = [];
  private unhandledChunks: DataChunk[] = [];

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.bufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
    this.ringBuffer = new RingBuffer(bufferSize);
    this.decodeBuffer = this.getScratchBuffer(4096);
  }

  get info(): WavDecoderInfo {
    return {
      decodedBytes: this.decodedBytes,
      format: this.format,
      parsedChunks: this.parsedChunks,
      remainingBytes: this.remainingBytes,
      state: this.state,
      totalBytes: this.totalBytes,
      unhandledChunks: this.unhandledChunks,
    };
  }

  get progress(): number {
    if (this.totalBytes > 0) {
      return this.decodedBytes / this.totalBytes;
    }
    return this.state === DecoderState.ENDED ? 1 : 0;
  }

  get totalDuration(): number {
    if (!this.format?.sampleRate || this.format.sampleRate <= 0) return 0;
    return this.totalFrames / this.format.sampleRate;
  }

  get totalFrames(): number {
    if (this.format?.factChunkSamples > 0) {
      return this.format.factChunkSamples;
    }
    if (this.totalBytes > 0 && this.format?.blockAlign > 0) {
      if (this.format.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
        const blocks = Math.floor(this.totalBytes / this.format.blockAlign);
        return blocks * (this.format.samplesPerBlock ?? 0);
      }
      return Math.floor(this.totalBytes / this.format.blockAlign);
    }
    return 0;
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
    const collector = this.createErrorCollector();

    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createErrorResult('Decoder is in a terminal state.', collector);
    }

    try {
      if (this.state === DecoderState.IDLE) {
        if (this.headerBuffer.length + chunk.length > WavDecoder.MAX_HEADER_SIZE) {
          this.state = DecoderState.ERROR;
          return this.createErrorResult('Header size exceeds maximum limit.', collector);
        }

        const combined = new Uint8Array(this.headerBuffer.length + chunk.length);
        combined.set(this.headerBuffer, 0);
        combined.set(chunk, this.headerBuffer.length);
        this.headerBuffer = combined;

        this.tryParseHeader(collector);

        if (this.state === DecoderState.IDLE) {
          return this.createEmptyResult(collector);
        } else if (this.state === DecoderState.ERROR) {
          return this.createEmptyResult(collector);
        }
      } else {
        if (this.ringBuffer.write(chunk) < chunk.length) {
          this.state = DecoderState.ERROR;
          return this.createErrorResult('Audio buffer capacity exceeded.', collector);
        }
      }

      return this.processBufferedBlocks(collector);
    } catch (err) {
      this.state = DecoderState.ERROR;
      const error = err instanceof Error ? err : new Error(String(err));
      this.addErrorToCollector(collector, {
        message: `Decode error: ${error.message}`,
        frameLength: this.format.blockAlign ?? 0,
        frameNumber: this.format.blockAlign ? Math.floor(this.decodedBytes / this.format.blockAlign) : 0,
        inputBytes: this.decodedBytes,
        outputSamples: this.totalFrames,
      });
      return this.createErrorResult('Decode error', collector);
    }
  }

  public decodeFrame(frame: Uint8Array): Float32Array {
    const collector = this.createErrorCollector();

    if (this.state !== DecoderState.DECODING || frame.length !== this.format.blockAlign) {
      return new Float32Array(this.format?.channels || 2);
    }
    if (this.format.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
      return new Float32Array(this.format.channels);
    }

    const { channels } = this.format;
    const output = new Float32Array(channels);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.length);

    for (let ch = 0; ch < channels; ch++) {
      const offset = ch * this.format.bytesPerSample;
      output[ch] = this.readSample(
        view,
        offset,
        this.format.bitsPerSample,
        this.format.resolvedFormatTag,
        collector,
        ch
      );
    }

    return output;
  }

  public decodeFrames(frames: Uint8Array[]): DecodedWavAudio {
    const collector = this.createErrorCollector();
    const { blockAlign, channels, bitsPerSample, sampleRate } = this.format;
    const nFrames = frames.length;
    const output = Array.from({ length: channels }, () => new Float32Array(nFrames));

    let validFrames = 0;
    for (let i = 0; i < nFrames; ++i) {
      const frame = frames[i]!;
      if (frame.length !== blockAlign) {
        this.addErrorToCollector(collector, {
          frameLength: frame.length,
          frameNumber: i,
          inputBytes: validFrames * blockAlign,
          outputSamples: validFrames,
          message: `Dropped partial or malformed frame at index ${i} (got ${frame.length}, expected ${blockAlign} bytes)`,
        });
        continue;
      }

      const decoded = this.decodeFrame(frame);
      if (!decoded) {
        this.addErrorToCollector(collector, {
          frameLength: frame.length,
          frameNumber: i,
          inputBytes: validFrames * blockAlign,
          outputSamples: validFrames,
          message: `Decode failed for frame ${i}`,
        });
        continue;
      }
      for (let ch = 0; ch < channels; ++ch) {
        output[ch]![validFrames] = decoded[ch]!;
      }
      validFrames++;
    }

    for (let ch = 0; ch < channels; ++ch) {
      output[ch] = output[ch]!.subarray(0, validFrames);
    }

    return {
      bitsPerSample,
      sampleRate,
      errors: collector.errors,
      channelData: output,
      samplesDecoded: validFrames,
    };
  }

  public flush(): DecodedWavAudio {
    const collector = this.createErrorCollector();

    if (this.state === DecoderState.ENDED || this.state === DecoderState.ERROR) {
      return this.createEmptyResult(collector);
    }

    const result = this.processBufferedBlocks(collector);
    const leftoverBytes = this.ringBuffer.available;

    if (leftoverBytes > 0) {
      this.addErrorToCollector(collector, {
        message: `Stream ended with ${leftoverBytes} bytes of incomplete final block.`,
        frameLength: leftoverBytes,
        frameNumber: this.format.blockAlign ? Math.floor(this.decodedBytes / this.format.blockAlign) : 0,
        inputBytes: this.decodedBytes,
        outputSamples: this.totalFrames,
      });
      this.remainingBytes = Math.max(0, this.remainingBytes - leftoverBytes);
      this.ringBuffer.clear();
    }

    this.state = DecoderState.ENDED;
    return {
      ...result,
      errors: collector.errors,
    };
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
    this.format = {} as ExtendedWavFormat;
    this.remainingBytes = 0;
    this.decodedBytes = 0;
    this.totalBytes = 0;
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

  private tryParseHeader(collector: ErrorCollector): boolean {
    const headerData = this.headerBuffer;

    if (headerData.length < 20) {
      return false;
    }

    try {
      const result = parseWavHeader(headerData, {
        // maxChunks: 50,
      });

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          this.addErrorToCollector(collector, {
            message: `Header parse error: ${error}`,
            frameLength: 0,
            frameNumber: 0,
            inputBytes: 0,
            outputSamples: 0,
          });
        }
        return false;
      }

      if (!result.format) {
        return false;
      }

      this.format = {
        ...result.format,
        factChunkSamples: 0,
        dataChunks: result.dataChunks,
        isLittleEndian: result.isLittleEndian,
        resolvedFormatTag: result.format.formatTag,
        bytesPerSample: 0,
      };

      this.parsedChunks = result.parsedChunks;
      this.unhandledChunks = result.unhandledChunks;

      if (this.format.formatTag === WAVE_FORMAT_EXTENSIBLE) {
        this.format.resolvedFormatTag = this.resolveExtensibleFormat();
      }

      this.format.bytesPerSample =
        this.format.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM ? 0 : this.format.bitsPerSample / 8;

      if (!this.validateFormat(collector)) {
        this.state = DecoderState.ERROR;
        return false;
      }

      const allChunks = [...result.parsedChunks, ...result.unhandledChunks];
      const factChunk = allChunks.find((chunk) => chunk.id === 'fact');
      if (factChunk && factChunk.size >= 4) {
        const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.length);
        if (factChunk.offset + 12 <= headerData.length) {
          this.format.factChunkSamples = view.getUint32(factChunk.offset + 8, this.format.isLittleEndian);
        }
      }

      this.totalBytes = result.dataBytes;
      this.remainingBytes = this.totalBytes;

      for (const dataChunk of this.format.dataChunks) {
        const start = dataChunk.offset;
        const end = start + dataChunk.size;
        const chunkData = headerData.subarray(start, end);
        if (chunkData.length > 0) {
          const written = this.ringBuffer.write(chunkData);
          if (written < chunkData.length) {
            this.failHard(
              `Ring buffer full during header parse: tried to write ${chunkData.length} bytes at offset ${start}, only ${written} bytes could be written`,
              collector
            );
            return false;
          }
        }
      }

      this.headerBuffer = new Uint8Array(0);
      this.state = DecoderState.DECODING;
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.addErrorToCollector(collector, {
        message: `Header parse issue: ${error.message}`,
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }
  }

  private resolveExtensibleFormat(): number {
    const sf = this.format.subFormat;
    if (!sf) return this.format.formatTag;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
    return this.format.formatTag;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private validateFormat(collector: ErrorCollector): boolean {
    const fmt = this.format;
    if (!fmt?.bitsPerSample || !fmt.channels || !fmt.sampleRate) {
      this.addErrorToCollector(collector, {
        message: 'Invalid format: zero values in required fields',
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }
    if (fmt.channels > WavDecoder.MAX_CHANNELS) {
      this.addErrorToCollector(collector, {
        message: `Too many channels: ${fmt.channels} (max ${WavDecoder.MAX_CHANNELS})`,
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }
    if (fmt.sampleRate > WavDecoder.MAX_SAMPLE_RATE) {
      this.addErrorToCollector(collector, {
        message: `Sample rate too high: ${fmt.sampleRate} (max ${WavDecoder.MAX_SAMPLE_RATE})`,
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }
    if (!WavDecoder.supports(fmt.resolvedFormatTag)) {
      this.addErrorToCollector(collector, {
        message: `Unsupported audio format: 0x${fmt.resolvedFormatTag.toString(16)}`,
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }

    const validBitDepths = this.getValidBitDepths(fmt.resolvedFormatTag);
    if (!validBitDepths.includes(fmt.bitsPerSample)) {
      this.addErrorToCollector(collector, {
        message: `Invalid bit depth: ${fmt.bitsPerSample} for format 0x${fmt.resolvedFormatTag.toString(16)}`,
        frameLength: 0,
        frameNumber: 0,
        inputBytes: 0,
        outputSamples: 0,
      });
      return false;
    }

    this.validateAndFixBlockAlignment(collector);
    return true;
  }

  private validateAndFixBlockAlignment(collector: ErrorCollector): void {
    const fmt = this.format;
    const { bitsPerSample, channels, sampleRate, blockAlign, bytesPerSecond } = fmt;

    if (fmt.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
      const expectedBlockSize = 4 * channels + Math.ceil(((fmt.samplesPerBlock! - 1) * channels) / 2);
      if (blockAlign !== expectedBlockSize) {
        const message = `Invalid blockAlign for IMA ADPCM: was ${blockAlign}, expected ${expectedBlockSize}`;
        this.addErrorToCollector(collector, {
          message,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: 0,
        });
        fmt.blockAlign = expectedBlockSize;
      }
      const expectedByteRate = Math.ceil((sampleRate * fmt.blockAlign) / fmt.samplesPerBlock!);
      if (bytesPerSecond !== expectedByteRate) {
        const message = `Invalid byteRate for IMA ADPCM: was ${bytesPerSecond}, expected ${expectedByteRate}`;
        this.addErrorToCollector(collector, {
          message,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: 0,
        });
        fmt.bytesPerSecond = expectedByteRate;
      }
    } else {
      const expectedBlockAlign = (bitsPerSample / 8) * channels;
      if (blockAlign !== expectedBlockAlign && expectedBlockAlign > 0) {
        const message = `Invalid blockAlign: was ${blockAlign}, expected ${expectedBlockAlign}`;
        this.addErrorToCollector(collector, {
          message,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: 0,
        });
        fmt.blockAlign = expectedBlockAlign;
      }
      const expectedByteRate = sampleRate * fmt.blockAlign;
      if (bytesPerSecond !== expectedByteRate && expectedByteRate > 0) {
        const message = `Invalid byteRate: was ${bytesPerSecond}, expected ${expectedByteRate}`;
        this.addErrorToCollector(collector, {
          message,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: 0,
        });
        fmt.bytesPerSecond = expectedByteRate;
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

  private initChannelData(channels: number, samples: number): void {
    if (this.channelData.length === channels && this.channelData[0]!.length >= samples) {
      return;
    }
    this.channelData = Array.from({ length: channels }, () => new Float32Array(samples));
  }

  private processBufferedBlocks(collector: ErrorCollector): DecodedWavAudio {
    const { blockAlign } = this.format;
    if (this.state !== DecoderState.DECODING || !blockAlign || this.ringBuffer.available < blockAlign) {
      return this.createEmptyResult(collector);
    }

    const blocks = Math.floor(this.ringBuffer.available / blockAlign);
    const bytes = blocks * blockAlign;

    const tail = this.ringBuffer.peekContiguous();
    if (tail.length >= bytes) {
      const out = this.decodeInterleavedFrames(tail.subarray(0, bytes), collector);
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

    const out = this.decodeInterleavedFrames(scratch, collector);
    this.ringBuffer.discard(bytes);
    this.decodedBytes += bytes;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytes);
    return out;
  }

  private decodeInterleavedFrames(frames: Uint8Array, collector: ErrorCollector): DecodedWavAudio {
    const { blockAlign, channels, sampleRate, bitsPerSample, resolvedFormatTag } = this.format;

    if (!blockAlign || !channels) {
      return this.createErrorResult('Invalid internal format state during decodeInterleavedFrames', collector);
    }

    let samplesDecoded: number;
    let outputBitDepth = resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM ? 16 : bitsPerSample;

    if (resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
      const { samplesPerBlock } = this.format;
      if (!samplesPerBlock) {
        return this.createErrorResult('Missing samplesPerBlock for IMA ADPCM', collector);
      }
      samplesDecoded = Math.floor((frames.length / blockAlign) * samplesPerBlock);
    } else {
      samplesDecoded = Math.floor(frames.length / blockAlign);
    }

    if (samplesDecoded <= 0) {
      return this.createEmptyResult(collector);
    }

    this.initChannelData(channels, samplesDecoded);
    if (this.channelData.length !== channels || this.channelData[0]!.length < samplesDecoded) {
      return this.createErrorResult('Failed to initialize channel buffers', collector);
    }

    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);

    switch (resolvedFormatTag) {
      case WAVE_FORMAT_PCM:
        this.dispatchPCMDecode(view, samplesDecoded, bitsPerSample, channels, collector);
        break;
      case WAVE_FORMAT_IEEE_FLOAT:
        this.dispatchFloatDecode(view, samplesDecoded, bitsPerSample, channels, collector);
        break;
      case WAVE_FORMAT_ALAW:
      case WAVE_FORMAT_MULAW:
        this.decodeCompressed(view, samplesDecoded, collector);
        break;
      case WAVE_FORMAT_IMA_ADPCM:
        this.decodeImaAdpcm(frames, samplesDecoded, collector);
        break;
      default:
        this.channelData.forEach((arr) => arr.fill(0));
    }

    const channelData = this.channelData.map((arr) => arr.subarray(0, samplesDecoded));

    return {
      bitsPerSample: outputBitDepth,
      channelData,
      errors: collector.errors,
      sampleRate,
      samplesDecoded,
    };
  }

  private dispatchPCMDecode(
    view: DataView,
    samples: number,
    bitsPerSample: number,
    channels: number,
    collector: ErrorCollector
  ): void {
    if (channels === 1) {
      switch (bitsPerSample) {
        case 8:
          decodePCM8Mono(new Uint8Array(view.buffer, view.byteOffset, samples), this.channelData[0]!, samples);
          return;
        case 16:
          decodePCM16Mono(new Int16Array(view.buffer, view.byteOffset, samples), this.channelData[0]!, samples);
          return;
        case 24:
          decodePCM24Mono(new Uint8Array(view.buffer, view.byteOffset, samples * 3), this.channelData[0]!, samples);
          return;
        case 32:
          decodePCM32Mono(new Int32Array(view.buffer, view.byteOffset, samples), this.channelData[0]!, samples);
          return;
      }
    } else if (channels === 2) {
      switch (bitsPerSample) {
        case 8:
          decodePCM8Stereo(
            new Uint8Array(view.buffer, view.byteOffset, samples * 2),
            this.channelData[0]!,
            this.channelData[1]!,
            samples
          );
          return;
        case 16:
          decodePCM16Stereo(
            new Int16Array(view.buffer, view.byteOffset, samples * 2),
            this.channelData[0]!,
            this.channelData[1]!,
            samples
          );
          return;
        case 24:
          decodePCM24Stereo(
            new Uint8Array(view.buffer, view.byteOffset, samples * 6),
            this.channelData[0]!,
            this.channelData[1]!,
            samples
          );
          return;
        case 32:
          decodePCM32Stereo(
            new Int32Array(view.buffer, view.byteOffset, samples * 2),
            this.channelData[0]!,
            this.channelData[1]!,
            samples
          );
          return;
      }
    }
    this.decodeGenericPCM(view, samples, bitsPerSample / 8, bitsPerSample, collector);
  }

  private dispatchFloatDecode(
    view: DataView,
    samples: number,
    bitsPerSample: number,
    channels: number,
    collector: ErrorCollector
  ): void {
    if (channels === 1 && bitsPerSample === 32) {
      if (this.format.isLittleEndian) {
        decodeFloat32Mono(new Float32Array(view.buffer, view.byteOffset, samples), this.channelData[0]!, samples);
      } else {
        this.decodeFloat(view, samples, 4, 32, collector);
      }
      return;
    }

    if (channels === 2 && bitsPerSample === 32) {
      if (this.format.isLittleEndian) {
        decodeFloat32Stereo(
          new Float32Array(view.buffer, view.byteOffset, samples * 2),
          this.channelData[0]!,
          this.channelData[1]!,
          samples
        );
      } else {
        this.decodeFloat(view, samples, 4, 32, collector);
      }
      return;
    }

    this.decodeFloat(view, samples, bitsPerSample / 8, bitsPerSample, collector);
  }

  private decodeFloat(
    view: DataView,
    samples: number,
    bps: number,
    bitsPerSample: number,
    collector: ErrorCollector
  ): void {
    const numChannels = this.format.channels;
    const blockSize = this.format.blockAlign;
    const is64Bit = bitsPerSample === 64;

    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        if (ch >= this.channelData.length || !this.channelData[ch]) {
          this.addErrorToCollector(collector, {
            message: `Float decode: Invalid channel index ${ch}`,
            frameLength: bps,
            frameNumber: i,
            inputBytes: this.decodedBytes + base,
            outputSamples: i,
          });
          continue;
        }

        const offset = base + ch * bps;
        if (offset + (is64Bit ? 8 : 4) > view.byteLength) {
          this.addErrorToCollector(collector, {
            message: `Float decode: out-of-bounds access at offset ${offset}`,
            frameLength: bps,
            frameNumber: i,
            inputBytes: this.decodedBytes + offset,
            outputSamples: samples,
          });
          this.channelData[ch]![i] = 0;
          continue;
        }

        try {
          let value: number;
          if (is64Bit) {
            value = view.getFloat64(offset, this.format.isLittleEndian);
          } else {
            value = view.getFloat32(offset, this.format.isLittleEndian);
          }
          this.channelData[ch]![i] = Math.max(-1, Math.min(1, value));
        } catch (err) {
          this.addErrorToCollector(collector, {
            message: `Float decode error at offset ${offset}: ${err instanceof Error ? err.message : String(err)}`,
            frameLength: bps,
            frameNumber: i,
            inputBytes: this.decodedBytes + offset,
            outputSamples: samples,
          });
          this.channelData[ch]![i] = 0;
        }
      }
    }
  }

  private decodeGenericPCM(
    view: DataView,
    samples: number,
    bytesPerSample: number,
    bitsPerSample: number,
    collector: ErrorCollector
  ): void {
    const numChannels = this.format.channels;
    let offset = 0;

    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        if (offset + bytesPerSample > view.byteLength) {
          this.addErrorToCollector(collector, {
            message: `PCM decode: out-of-bounds access at offset ${offset}`,
            frameLength: bytesPerSample,
            frameNumber: i,
            inputBytes: this.decodedBytes + offset,
            outputSamples: samples,
          });
          this.channelData[ch]![i] = 0;
          offset += bytesPerSample;
          continue;
        }
        this.channelData[ch]![i] = this.readSample(view, offset, bitsPerSample, WAVE_FORMAT_PCM, collector, i);
        offset += bytesPerSample;
      }
    }
  }

  private decodeCompressed(view: DataView, samples: number, collector: ErrorCollector): void {
    const numChannels = this.format.channels;
    const blockSize = this.format.blockAlign;
    const table = this.format.resolvedFormatTag === WAVE_FORMAT_ALAW ? ALAW_TABLE : MULAW_TABLE;
    const src = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

    for (let i = 0; i < samples; i++) {
      const base = i * blockSize;
      for (let ch = 0; ch < numChannels; ch++) {
        if (ch >= this.channelData.length || !this.channelData[ch]) {
          this.addErrorToCollector(collector, {
            message: `Compressed decode: Invalid channel index ${ch}`,
            frameLength: 1,
            frameNumber: i,
            inputBytes: this.decodedBytes + base,
            outputSamples: i,
          });
          continue;
        }

        const offset = base + ch;
        if (offset >= src.length) {
          this.addErrorToCollector(collector, {
            message: `Compressed decode: out-of-bounds access at offset ${offset}`,
            frameLength: 1,
            frameNumber: i,
            inputBytes: this.decodedBytes + offset,
            outputSamples: samples,
          });
          this.channelData[ch]![i] = 0;
          continue;
        }

        try {
          const value = src[offset]!;
          const sample = table[value];
          if (sample === undefined) {
            this.addErrorToCollector(collector, {
              message: `Compressed decode: invalid table lookup for value ${value} at offset ${offset}`,
              frameLength: 1,
              frameNumber: i,
              inputBytes: this.decodedBytes + offset,
              outputSamples: samples,
            });
            this.channelData[ch]![i] = 0;
          } else {
            this.channelData[ch]![i] = sample;
          }
        } catch (err) {
          this.addErrorToCollector(collector, {
            message: `Compressed decode error at offset ${offset}: ${err instanceof Error ? err.message : String(err)}`,
            frameLength: 1,
            frameNumber: i,
            inputBytes: this.decodedBytes + offset,
            outputSamples: samples,
          });
          this.channelData[ch]![i] = 0;
        }
      }
    }
  }

  private decodeImaAdpcm(frames: Uint8Array, samplesDecoded: number, collector: ErrorCollector): void {
    const { channels, blockAlign, samplesPerBlock } = this.format;
    const numBlocks = frames.length / blockAlign;
    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);

    for (let block = 0; block < numBlocks; block++) {
      const blockOffset = block * blockAlign;
      const headers: { predictor: number; stepIndex: number }[] = [];
      let headerOffset = blockOffset;
      let hasHeaderError = false;

      for (let ch = 0; ch < channels; ch++) {
        if (headerOffset + 4 > frames.length) {
          this.addErrorToCollector(collector, {
            message: `IMA ADPCM: incomplete header for block ${block}, channel ${ch}`,
            frameLength: 4,
            frameNumber: block,
            inputBytes: this.decodedBytes + headerOffset,
            outputSamples: samplesDecoded,
          });
          hasHeaderError = true;
          break;
        }
        try {
          headers.push({
            predictor: view.getInt16(headerOffset, this.format.isLittleEndian),
            stepIndex: view.getUint8(headerOffset + 2),
          });
        } catch (err) {
          this.addErrorToCollector(collector, {
            message: `IMA ADPCM: header read error for block ${block}, channel ${ch}: ${err instanceof Error ? err.message : String(err)}`,
            frameLength: 4,
            frameNumber: block,
            inputBytes: this.decodedBytes + headerOffset,
            outputSamples: samplesDecoded,
          });
          hasHeaderError = true;
          break;
        }
        headerOffset += 4;
      }

      if (hasHeaderError) {
        // Skip this block but continue processing others
        continue;
      }

      const compressedSize = blockAlign - 4 * channels;
      if (headerOffset + compressedSize > frames.length) {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM: incomplete compressed data for block ${block}`,
          frameLength: compressedSize,
          frameNumber: block,
          inputBytes: this.decodedBytes + headerOffset,
          outputSamples: samplesDecoded,
        });
        continue;
      }

      try {
        const compressedData = new Uint8Array(frames.buffer, frames.byteOffset + headerOffset, compressedSize);
        this.decodeImaAdpcmBlock(
          compressedData,
          headers,
          samplesPerBlock!,
          channels,
          block * samplesPerBlock!,
          collector
        );
      } catch (err) {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM block decode error: ${err instanceof Error ? err.message : String(err)}`,
          frameLength: compressedSize,
          frameNumber: block,
          inputBytes: this.decodedBytes + headerOffset,
          outputSamples: block * samplesPerBlock!,
        });
        // Continue to the next block
      }
    }
  }

  private decodeImaAdpcmBlock(
    compressed: Uint8Array,
    headers: {
      predictor: number;
      stepIndex: number;
    }[],
    samplesPerBlock: number,
    channels: number,
    outputOffset: number,
    collector: ErrorCollector
  ): void {
    const predictors = headers.map((h) => h.predictor);
    const stepIndices = headers.map((h) => Math.min(88, Math.max(0, h.stepIndex)));

    for (let ch = 0; ch < channels; ch++) {
      if (ch >= this.channelData.length || !this.channelData[ch]) {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM: Invalid channel index ${ch}`,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: outputOffset,
        });
        return;
      }
      this.channelData[ch]![outputOffset] = predictors[ch]! * INV_32768;
    }

    let sampleIndex = 1;
    let nibbleIndex = 0;

    const processNibble = (nibble: number, ch: number) => {
      if (ch >= stepIndices.length || ch >= predictors.length || ch >= this.channelData.length) {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM: Invalid channel index ${ch} during nibble processing`,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: outputOffset + sampleIndex,
        });
        return;
      }

      const step = IMA_STEP_TABLE[stepIndices[ch]!] ?? 0;
      let diff = step >> 3;
      if (nibble & 1) diff += step >> 2;
      if (nibble & 2) diff += step >> 1;
      if (nibble & 4) diff += step;
      if (nibble & 8) diff = -diff;

      predictors[ch]! += diff;
      predictors[ch] = Math.max(-32768, Math.min(32767, predictors[ch]!));
      stepIndices[ch] = Math.min(88, Math.max(0, stepIndices[ch]! + (IMA_INDEX_ADJUST_TABLE[nibble] ?? 0)));

      if (outputOffset + sampleIndex < this.channelData[ch]!.length) {
        this.channelData[ch]![outputOffset + sampleIndex] = predictors[ch]! * INV_32768;
      } else {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM: Buffer overflow at sample index ${sampleIndex}, output offset ${outputOffset}`,
          frameLength: 0,
          frameNumber: 0,
          inputBytes: 0,
          outputSamples: outputOffset + sampleIndex,
        });
      }
    };

    for (let i = 0; i < compressed.length; i++) {
      try {
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
      } catch (err) {
        this.addErrorToCollector(collector, {
          message: `IMA ADPCM: Error processing byte at index ${i}: ${err instanceof Error ? err.message : String(err)}`,
          frameLength: 1,
          frameNumber: 0,
          inputBytes: i,
          outputSamples: outputOffset + sampleIndex,
        });
      }
    }
  }

  private readSample(
    view: DataView,
    offset: number,
    bits: number,
    fmt: number,
    collector?: ErrorCollector,
    sampleIndex?: number
  ): number {
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
          if (collector)
            this.addErrorToCollector(collector, {
              message: `Unknown format 0x${fmt.toString(16)} at offset ${offset}`,
              frameLength: 0,
              frameNumber: sampleIndex ?? 0,
              inputBytes: offset,
              outputSamples: 0,
            });
          return 0;
      }
    } catch (err) {
      if (collector)
        this.addErrorToCollector(collector, {
          message: `Sample read error: ${err instanceof Error ? err.message : String(err)} (offset=${offset}, bits=${bits}, fmt=0x${fmt.toString(16)})`,
          frameLength: 0,
          frameNumber: sampleIndex ?? 0,
          inputBytes: offset,
          outputSamples: 0,
        });
      return 0;
    }
  }

  private readPcm(view: DataView, off: number, bits: number): number {
    switch (bits) {
      case 8:
        return (view.getUint8(off) - 128) * INV_128;
      case 16:
        return view.getInt16(off, this.format.isLittleEndian) * INV_32768;
      case 24: {
        if (off + 3 > view.byteLength) return 0;
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let val = this.format.isLittleEndian ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        val = (val << 8) >> 8;
        return val * INV_8388608;
      }
      case 32:
        return view.getInt32(off, this.format.isLittleEndian) * INV_2147483648;
      default:
        return 0;
    }
  }

  private readFloat(view: DataView, off: number, bits: number): number {
    switch (bits) {
      case 32:
        return Math.max(-1, Math.min(1, view.getFloat32(off, this.format.isLittleEndian)));
      case 64:
        return Math.max(-1, Math.min(1, view.getFloat64(off, this.format.isLittleEndian)));
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

  private createErrorCollector(): ErrorCollector {
    return {
      errors: [],
    };
  }

  private addErrorToCollector(collector: ErrorCollector, error: DecodeError): void {
    collector.errors.push(error);
  }

  private createEmptyResult(collector: ErrorCollector): DecodedWavAudio {
    return {
      bitsPerSample: this.format.bitsPerSample || 0,
      channelData: [],
      errors: collector.errors,
      sampleRate: this.format.sampleRate || 0,
      samplesDecoded: 0,
    };
  }

  private createErrorResult(msg: string, collector: ErrorCollector): DecodedWavAudio {
    this.addErrorToCollector(collector, {
      message: msg,
      frameLength: this.format.blockAlign ?? 0,
      frameNumber: this.format.blockAlign ? Math.floor(this.decodedBytes / this.format.blockAlign) : 0,
      inputBytes: this.decodedBytes,
      outputSamples: this.totalFrames,
    });
    return this.createEmptyResult(collector);
  }

  private failHard(message: string, collector: ErrorCollector): void {
    this.state = DecoderState.ERROR;
    this.addErrorToCollector(collector, {
      message,
      frameLength: this.format.blockAlign ?? 0,
      frameNumber: this.format.blockAlign ? Math.floor(this.decodedBytes / this.format.blockAlign) : 0,
      inputBytes: this.decodedBytes,
      outputSamples: this.totalFrames,
    });
  }
}
