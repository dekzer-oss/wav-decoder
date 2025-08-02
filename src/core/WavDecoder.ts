import {
  type AudioDecoder,
  type DecodedWavAudio,
  type DecoderOptions,
  type WavDecoderInfo,
  type WavHeaderParserResult,
} from '../types';
import { alaw, float, imaadpcm, mulaw, pcm } from '../decoders';
import { RingBuffer } from './RingBuffer';
import { parseWavHeader } from '../utils/parseWavHeader';

import {
  KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
  KSDATAFORMAT_SUBTYPE_PCM,
  MAX_BUFFER_SIZE,
  MAX_CHANNELS,
  MAX_HEADER_SIZE,
  MAX_SAMPLE_RATE,
  WAVE_FORMAT_ALAW,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_FORMAT_MULAW,
  WAVE_FORMAT_PCM,
} from '../constants';

import { StateManager } from './StateManager';
import { ErrorFactory } from './ErrorFactory';
import { DecoderState, DecoderStateMachine } from './StateMachine';

export class WavDecoder implements AudioDecoder {
  private readonly _stateMachine = new DecoderStateMachine();
  private readonly _stateManager: StateManager = new StateManager();
  private readonly _errorFactory = new ErrorFactory(this._stateManager);
  private readonly _ringBuffer: RingBuffer;
  private _headerBuffer = new Uint8Array(0);
  private _channelData: Float32Array[] = [];
  private _isFlushCalled = false;

  constructor(options: DecoderOptions = {}) {
    const bufferSize = options.bufferSize ?? MAX_BUFFER_SIZE;
    this._ringBuffer = new RingBuffer(bufferSize);
  }

  public parseHeader(header: Uint8Array): WavHeaderParserResult {
    return parseWavHeader(header);
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

  public supports(formatTag: number): boolean {
    return WavDecoder.supports(formatTag);
  }

  public decode(chunk: Uint8Array): DecodedWavAudio {
    if (this._stateManager.state === DecoderState.IDLE) {
      return this.handleHeaderParsing(chunk);
    } else {
      return this.handleAudioData(chunk);
    }
  }

  public flush(): DecodedWavAudio {
    if (this._stateMachine.state === DecoderState.ENDED || this._stateMachine.state === DecoderState.ERROR) {
      return this.createEmptyResult();
    }
    if (this._isFlushCalled) {
      return this.createErrorResult('Flush has already been called on this decoder instance.');
    }
    this._isFlushCalled = true;

    if (this._stateMachine.state === DecoderState.DECODING) {
      const result = this.processBufferedBlocks();
      const leftoverBytes = this._ringBuffer.available;

      if (leftoverBytes > 0) {
        const msg = `Stream ended with ${leftoverBytes} bytes of incomplete final block.`;
        const err = this._errorFactory.create(msg);
        this._stateManager.errors.push(err);
        this._stateManager.remainingBytes = Math.max(0, this._stateManager.remainingBytes - leftoverBytes);
        this._ringBuffer.clear();
      }
      this._stateMachine.transition(DecoderState.ENDED);
      this._stateManager.end();
      return {
        ...result,
        errors: this.collectAllErrors(),
      };
    }

    if (this._stateMachine.state === DecoderState.IDLE) {
      this._stateMachine.transition(DecoderState.ERROR);
      return this.createErrorResult('Cannot flush: insufficient data to begin decoding.');
    }

    return this.createEmptyResult();
  }

  public free(): void {
    if (this._stateMachine.state !== DecoderState.ENDED && this._stateMachine.state !== DecoderState.ERROR) {
      this._stateMachine.transition(DecoderState.ENDED);
    }
    this._ringBuffer.clear();
    this._headerBuffer = new Uint8Array(0);
    this._channelData = [];
    this._stateManager.end();
  }

  public reset(): void {
    this._stateMachine.reset();
    this._stateManager.reset();
    this._ringBuffer.clear();
    this._headerBuffer = new Uint8Array(0);
    this._channelData = [];
    this._isFlushCalled = false;
  }

  private handleHeaderParsing(chunk: Uint8Array): DecodedWavAudio {
    if (this._headerBuffer.length + chunk.length > MAX_HEADER_SIZE) {
      this._stateMachine.transition(DecoderState.ERROR);
      return this.createErrorResult('Header size exceeds maximum limit.');
    }

    const combined = new Uint8Array(this._headerBuffer.length + chunk.length);
    combined.set(this._headerBuffer, 0);
    combined.set(chunk, this._headerBuffer.length);
    this._headerBuffer = combined;

    const headerParsed = this.tryParseHeader();
    if (headerParsed && this._stateMachine.state === DecoderState.DECODING) {
      return this.processBufferedBlocks();
    } else if (this._stateMachine.state === DecoderState.ERROR) {
      return this.createErrorResult('Header parsing failed');
    }

    return this.createEmptyResult();
  }

  private tryParseHeader(): boolean {
    const headerData = this._headerBuffer;
    if (headerData.length < 20) return false;

    try {
      const result = parseWavHeader(headerData);

      if (result.errors.length > 0) {
        for (const error of result.errors) {
          const err = this._errorFactory.create(`Header parse error: ${error}`);
          this._stateManager.errors.push(err);
        }
        return false;
      }

      if (!result.format) return false;

      this._stateManager.format = {
        ...result.format,
        dataChunks: result.dataChunks,
        isLittleEndian: result.isLittleEndian,
        resolvedFormatTag: result.format.formatTag,
        bytesPerSample: 0,
      };

      if (this._stateManager.format.formatTag === WAVE_FORMAT_EXTENSIBLE) {
        this._stateManager.format.resolvedFormatTag = this.resolveExtensibleFormat();
      }

      this._stateManager.format.bytesPerSample =
        this._stateManager.format.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM
          ? 0
          : this._stateManager.format.bitsPerSample / 8;

      if (!this.validateFormat()) {
        this._stateMachine.transition(DecoderState.ERROR);
        this._stateManager.setError('Invalid WAV format after header parsing');
        return false;
      }

      this.handleFactChunk(result, headerData);
      this.initializeDataProcessing(result, headerData);

      this._headerBuffer = new Uint8Array(0);
      this._stateMachine.transition(DecoderState.DECODING);
      this._stateManager.state = DecoderState.DECODING;

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const decodeErr = this._errorFactory.create(`Header parse issue: ${error.message}`);
      this._stateManager.errors.push(decodeErr);
      return false;
    }
  }

  private handleFactChunk(result: WavHeaderParserResult, headerData: Uint8Array): void {
    const allChunks = [...result.parsedChunks, ...result.unhandledChunks];
    const factChunk = allChunks.find((chunk) => chunk.id === 'fact');
    if (factChunk && factChunk.size >= 4) {
      const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.length);
      if (factChunk.offset + 12 <= headerData.length) {
        this._stateManager.format.factChunkSamples = view.getUint32(
          factChunk.offset + 8,
          this._stateManager.format.isLittleEndian
        );
      }
    }
  }

  private initializeDataProcessing(result: WavHeaderParserResult, headerData: Uint8Array): void {
    this._stateManager.totalBytes = result.dataBytes;
    this._stateManager.remainingBytes = this._stateManager.totalBytes;

    const format = this._stateManager.format;
    if (!format.dataChunks || format.dataChunks.length === 0) {
      this._stateMachine.transition(DecoderState.ERROR);
      this._stateManager.setError('No data chunks found in the WAV header');
      return;
    }

    for (const dataChunk of format.dataChunks) {
      const start = dataChunk.offset;
      const end = start + dataChunk.size;
      const chunkData = headerData.subarray(start, end);
      if (chunkData.length > 0) {
        const written = this._ringBuffer.write(chunkData);
        if (written < chunkData.length) {
          const msg = `Ring buffer full during header parse: tried to write ${chunkData.length} bytes at offset ${start}, only ${written} bytes could be written`;
          const err = this._errorFactory.create(msg);
          this._stateManager.errors.push(err);
          this._stateMachine.transition(DecoderState.ERROR);
          return;
        }
      }
    }
  }

  private resolveExtensibleFormat(): number {
    const sf = this._stateManager.format.subFormat;
    if (!sf) return this._stateManager.format.formatTag;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
    if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
    return this._stateManager.format.formatTag;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private validateFormat(): boolean {
    const fmt = this._stateManager.format;

    if (!fmt?.bitsPerSample || !fmt.channels || !fmt.sampleRate) {
      const err = this._errorFactory.create('Invalid format: zero values in required fields');
      this._stateManager.errors.push(err);
      return false;
    }

    if (fmt.channels < 1 || fmt.channels > MAX_CHANNELS) {
      const err = this._errorFactory.create(`Invalid number of channels: ${fmt.channels} (min 1, max ${MAX_CHANNELS})`);
      this._stateManager.errors.push(err);
      return false;
    }

    if (fmt.sampleRate > MAX_SAMPLE_RATE) {
      const err = this._errorFactory.create(`Sample rate too high: ${fmt.sampleRate} (max ${MAX_SAMPLE_RATE})`);
      this._stateManager.errors.push(err);
      return false;
    }

    const resolvedFormatTag = fmt.resolvedFormatTag || fmt.formatTag;
    const VALID_FORMATS =
      (1 << WAVE_FORMAT_PCM) |
      (1 << WAVE_FORMAT_IEEE_FLOAT) |
      (1 << WAVE_FORMAT_ALAW) |
      (1 << WAVE_FORMAT_MULAW) |
      (1 << WAVE_FORMAT_IMA_ADPCM);

    if (!(VALID_FORMATS & (1 << resolvedFormatTag))) {
      const err = this._errorFactory.create(`Unsupported audio format: 0x${resolvedFormatTag.toString(16)}`);
      this._stateManager.errors.push(err);
      return false;
    }

    const validBitsPerSample = this.getValidBitDepths(resolvedFormatTag);
    if (!validBitsPerSample.includes(fmt.bitsPerSample)) {
      const err = this._errorFactory.create(
        `Invalid bit depth: ${fmt.bitsPerSample} for format 0x${resolvedFormatTag.toString(16)}`
      );
      this._stateManager.errors.push(err);
      return false;
    }

    this.fixBlockAlignment();
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
      case WAVE_FORMAT_IMA_ADPCM:
        return [4];
      default:
        return [];
    }
  }

  private fixBlockAlignment(): void {
    const fmt = this._stateManager.format;
    if (fmt.resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
      this.fixIMADPCMAlignment(fmt);
    } else {
      this.fixStandardAlignment(fmt);
    }
  }

  private fixIMADPCMAlignment(fmt: any): void {
    const { channels, blockAlign, bytesPerSecond, sampleRate, samplesPerBlock } = fmt;

    if (!samplesPerBlock || samplesPerBlock <= 0) {
      const err = this._errorFactory.create(
        `IMA ADPCM format error: samplesPerBlock is missing or invalid (${samplesPerBlock})`
      );
      this._stateManager.errors.push(err);
      return;
    }

    const expectedBlockSize = 4 * channels + Math.ceil(((samplesPerBlock - 1) * channels) / 2);
    if (blockAlign !== expectedBlockSize) {
      fmt.blockAlign = expectedBlockSize;
    }

    const expectedByteRate = Math.ceil((sampleRate * fmt.blockAlign) / samplesPerBlock);
    if (bytesPerSecond !== expectedByteRate) {
      fmt.bytesPerSecond = expectedByteRate;
    }
  }

  private fixStandardAlignment(fmt: any): void {
    const { bitsPerSample, channels, sampleRate } = fmt;

    const expectedBlockAlign = (bitsPerSample / 8) * channels;
    if (expectedBlockAlign > 0) {
      fmt.blockAlign = expectedBlockAlign;
    }

    const expectedByteRate = sampleRate * fmt.blockAlign;
    if (expectedByteRate > 0) {
      fmt.bytesPerSecond = expectedByteRate;
    }
  }

  private handleAudioData(chunk: Uint8Array): DecodedWavAudio {
    if (this._ringBuffer.write(chunk) < chunk.length) {
      this._stateMachine.transition(DecoderState.ERROR);
      return this.createErrorResult('Audio buffer capacity exceeded.');
    }
    return this.processBufferedBlocks();
  }

  private processBufferedBlocks(): DecodedWavAudio {
    const { blockAlign } = this._stateManager.format;

    if (this._stateMachine.state !== DecoderState.DECODING || !blockAlign || this._ringBuffer.available < blockAlign) {
      return this.createEmptyResult();
    }

    const blocks = Math.floor(this._ringBuffer.available / blockAlign);
    const bytes = blocks * blockAlign;

    const tail = this._ringBuffer.peekContiguous();
    let result: DecodedWavAudio;

    if (tail.length >= bytes) {
      result = this.decodeInterleavedFrames(tail.subarray(0, bytes));
      this._ringBuffer.discard(bytes);
      this._stateManager.updateProgress(bytes);
    } else {
      const scratch = new Uint8Array(bytes);
      const headLen = bytes - tail.length;
      const head = this._ringBuffer.peek(headLen, tail.length);

      scratch.set(tail, 0);
      scratch.set(head, tail.length);

      result = this.decodeInterleavedFrames(scratch);
      this._ringBuffer.discard(bytes);
      this._stateManager.updateProgress(bytes);
    }

    return result;
  }

  private decodeInterleavedFrames(frames: Uint8Array): DecodedWavAudio {
    const { blockAlign, channels, sampleRate, bitsPerSample, resolvedFormatTag } = this._stateManager.format;

    if (!blockAlign || !channels) {
      return this.createErrorResult('Invalid internal format state during decodeInterleavedFrames');
    }

    const samplesDecoded = this.calculateSamplesDecoded(frames, resolvedFormatTag, blockAlign);
    if (samplesDecoded <= 0) {
      return this.createEmptyResult();
    }

    const outputBitsPerSample = resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM ? 16 : bitsPerSample;

    this.initChannelData(channels, samplesDecoded);

    const view = this.createSafeDataView(frames);
    if (!view) {
      return this.createErrorResult('Failed to create DataView for audio data');
    }

    this.decodeByFormat(resolvedFormatTag, view, frames, samplesDecoded, channels, bitsPerSample);

    const channelData = this._channelData.map((arr) => arr.subarray(0, samplesDecoded));

    return {
      bitsPerSample: outputBitsPerSample,
      errors: this.errors,
      channelData,
      sampleRate,
      samplesDecoded,
    };
  }

  private calculateSamplesDecoded(
    frames: Uint8Array,
    resolvedFormatTag: number | undefined,
    blockAlign: number
  ): number {
    if (resolvedFormatTag === WAVE_FORMAT_IMA_ADPCM) {
      const { samplesPerBlock } = this._stateManager.format;
      if (!samplesPerBlock) return 0;
      return Math.floor((frames.length / blockAlign) * samplesPerBlock);
    } else {
      return Math.floor(frames.length / blockAlign);
    }
  }

  private createSafeDataView(frames: Uint8Array): DataView | null {
    try {
      return new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
    } catch (err) {
      return null;
    }
  }

  private initChannelData(channels: number, samples: number): void {
    if (this._channelData.length === channels && this._channelData[0]!.length >= samples) {
      return;
    }
    this._channelData = Array.from({ length: channels }, () => new Float32Array(samples));
  }

  private decodeByFormat(
    resolvedFormatTag: number | undefined,
    view: DataView,
    frames: Uint8Array,
    samplesDecoded: number,
    channels: number,
    bitsPerSample: number
  ): void {
    switch (resolvedFormatTag) {
      case WAVE_FORMAT_PCM:
        this.decodePCMFormat(view, samplesDecoded, channels, bitsPerSample);
        break;
      case WAVE_FORMAT_IEEE_FLOAT:
        this.decodeFloatFormat(view, samplesDecoded, channels, bitsPerSample);
        break;
      case WAVE_FORMAT_ALAW:
        this.decodeALawFormat(view, samplesDecoded, channels);
        break;
      case WAVE_FORMAT_MULAW:
        this.decodeMuLawFormat(view, samplesDecoded, channels);
        break;
      case WAVE_FORMAT_IMA_ADPCM:
        this.decodeIMADPCMFormat(frames, samplesDecoded);
        break;
      default:
        this.fillChannelsWithSilence();
    }
  }

  private decodePCMFormat(view: DataView, samplesDecoded: number, channels: number, bitsPerSample: number): void {
    const bytesPerSample = bitsPerSample / 8;
    const totalBytes = samplesDecoded * channels * bytesPerSample;

    if (view.byteLength < totalBytes) {
      this.fillChannelsWithSilence();
      return;
    }

    if (channels === 1) {
      this.decodePCMMono(view, samplesDecoded, bitsPerSample);
    } else if (channels === 2) {
      this.decodePCMStereo(view, samplesDecoded, bitsPerSample);
    } else {
      this.fillChannelsWithSilence();
    }
  }

  private decodePCMMono(view: DataView, samplesDecoded: number, bitsPerSample: number): void {
    const channel = this._channelData[0]!;

    switch (bitsPerSample) {
      case 8:
        pcm.decodePCM8Mono(new Uint8Array(view.buffer, view.byteOffset, samplesDecoded), channel, samplesDecoded);
        break;
      case 16:
        pcm.decodePCM16Mono(new Int16Array(view.buffer, view.byteOffset, samplesDecoded), channel, samplesDecoded);
        break;
      case 24:
        pcm.decodePCM24Mono(new Uint8Array(view.buffer, view.byteOffset, samplesDecoded * 3), channel, samplesDecoded);
        break;
      case 32:
        pcm.decodePCM32Mono(new Int32Array(view.buffer, view.byteOffset, samplesDecoded), channel, samplesDecoded);
        break;
      default:
        channel.fill(0);
    }
  }

  private decodePCMStereo(view: DataView, samplesDecoded: number, bitsPerSample: number): void {
    const leftChannel = this._channelData[0]!;
    const rightChannel = this._channelData[1]!;

    switch (bitsPerSample) {
      case 8:
        pcm.decodePCM8Stereo(
          new Uint8Array(view.buffer, view.byteOffset, samplesDecoded * 2),
          leftChannel,
          rightChannel,
          samplesDecoded
        );
        break;
      case 16:
        pcm.decodePCM16Stereo(
          new Int16Array(view.buffer, view.byteOffset, samplesDecoded * 2),
          leftChannel,
          rightChannel,
          samplesDecoded
        );
        break;
      case 24:
        pcm.decodePCM24Stereo(
          new Uint8Array(view.buffer, view.byteOffset, samplesDecoded * 6),
          leftChannel,
          rightChannel,
          samplesDecoded
        );
        break;
      case 32:
        pcm.decodePCM32Stereo(
          new Int32Array(view.buffer, view.byteOffset, samplesDecoded * 2),
          leftChannel,
          rightChannel,
          samplesDecoded
        );
        break;
      default:
        leftChannel.fill(0);
        rightChannel.fill(0);
    }
  }

  private decodeFloatFormat(view: DataView, samplesDecoded: number, channels: number, bitsPerSample: number): void {
    const bytesPerSample = bitsPerSample / 8;
    const totalBytes = samplesDecoded * channels * bytesPerSample;

    if (view.byteLength < totalBytes) {
      this.fillChannelsWithSilence();
      return;
    }

    if (channels === 1) {
      if (bitsPerSample === 32) {
        float.decodeFloat32Mono(
          new Float32Array(view.buffer, view.byteOffset, samplesDecoded),
          this._channelData[0]!,
          samplesDecoded
        );
      } else if (bitsPerSample === 64) {
        float.decodeFloat64Mono(
          new Float64Array(view.buffer, view.byteOffset, samplesDecoded),
          this._channelData[0]!,
          samplesDecoded
        );
      } else {
        this._channelData[0]!.fill(0);
      }
    } else if (channels === 2) {
      if (bitsPerSample === 32) {
        float.decodeFloat32Stereo(
          new Float32Array(view.buffer, view.byteOffset, samplesDecoded * 2),
          this._channelData[0]!,
          this._channelData[1]!,
          samplesDecoded
        );
      } else if (bitsPerSample === 64) {
        float.decodeFloat64Stereo(
          new Float64Array(view.buffer, view.byteOffset, samplesDecoded * 2),
          this._channelData[0]!,
          this._channelData[1]!,
          samplesDecoded
        );
      } else {
        this._channelData[0]!.fill(0);
        this._channelData[1]!.fill(0);
      }
    } else {
      this.fillChannelsWithSilence();
    }
  }

  private decodeALawFormat(view: DataView, samplesDecoded: number, channels: number): void {
    if (channels === 1) {
      alaw.decodeALawMono(
        new Uint8Array(view.buffer, view.byteOffset, samplesDecoded),
        this._channelData[0]!,
        samplesDecoded
      );
    } else if (channels === 2) {
      alaw.decodeALawStereo(
        new Uint8Array(view.buffer, view.byteOffset, samplesDecoded * 2),
        this._channelData[0]!,
        this._channelData[1]!,
        samplesDecoded
      );
    } else {
      this.fillChannelsWithSilence();
    }
  }

  private decodeMuLawFormat(view: DataView, samplesDecoded: number, channels: number): void {
    if (channels === 1) {
      mulaw.decodeMuLawMono(
        new Uint8Array(view.buffer, view.byteOffset, samplesDecoded),
        this._channelData[0]!,
        samplesDecoded
      );
    } else if (channels === 2) {
      mulaw.decodeMuLawStereo(
        new Uint8Array(view.buffer, view.byteOffset, samplesDecoded * 2),
        this._channelData[0]!,
        this._channelData[1]!,
        samplesDecoded
      );
    } else {
      this.fillChannelsWithSilence();
    }
  }

  private decodeIMADPCMFormat(frames: Uint8Array, samplesDecoded: number): void {
    const { channels, blockAlign, samplesPerBlock } = this._stateManager.format;

    if (!samplesPerBlock || samplesPerBlock <= 0 || !blockAlign || blockAlign <= 0) {
      this.fillChannelsWithSilence();
      return;
    }

    const numBlocks = Math.floor(frames.length / blockAlign);
    if (numBlocks === 0) {
      this.fillChannelsWithSilence();
      return;
    }

    const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength);
    const expectedHeaderSize = 4 * channels;
    const expectedCompressedSize = blockAlign - expectedHeaderSize;

    const headers: { predictor: number; stepIndex: number }[] = new Array(channels);

    for (let block = 0; block < numBlocks; block++) {
      const blockOffset = block * blockAlign;

      if (blockOffset + blockAlign > frames.length) continue;

      let headerOffset = blockOffset;
      let headerParseSuccess = true;

      for (let ch = 0; ch < channels; ch++) {
        if (headerOffset + 4 > frames.length) {
          headerParseSuccess = false;
          break;
        }

        const predictor = view.getInt16(headerOffset, this._stateManager.format.isLittleEndian);
        const stepIndex = view.getUint8(headerOffset + 2);

        headers[ch] = {
          predictor,
          stepIndex: stepIndex > 88 ? 88 : stepIndex,
        };

        headerOffset += 4;
      }

      if (!headerParseSuccess) continue;

      const compressedDataOffset = blockOffset + expectedHeaderSize;
      if (compressedDataOffset + expectedCompressedSize <= frames.length) {
        const compressedData = new Uint8Array(
          frames.buffer,
          frames.byteOffset + compressedDataOffset,
          expectedCompressedSize
        );

        try {
          imaadpcm.decodeIMAADPCMBlock(
            compressedData,
            headers,
            samplesPerBlock,
            channels,
            block * samplesPerBlock,
            this._channelData
          );
        } catch (err) {
          const blockStartSample = block * samplesPerBlock;
          const blockEndSample = Math.min(blockStartSample + samplesPerBlock, samplesDecoded);
          for (let ch = 0; ch < channels; ch++) {
            const channel = this._channelData[ch];
            if (channel) {
              channel.fill(0, blockStartSample, blockEndSample);
            }
          }
        }
      }
    }
  }

  private fillChannelsWithSilence(): void {
    this._channelData.forEach((arr) => arr.fill(0));
  }

  private collectAllErrors(): any[] {
    const timestamp = new Date().toISOString();
    const stateManagerErrors = (this._stateManager.errors || []).map((error) => ({
      ...error,
      source: 'StateManager',
      timestamp,
    }));

    const stateMachineErrors = this._stateMachine.errors.map((errorMsg) => ({
      ...this._errorFactory.create(errorMsg),
      source: 'StateMachine',
      timestamp,
    }));

    return [...stateManagerErrors, ...stateMachineErrors];
  }

  private createEmptyResult(): DecodedWavAudio {
    const f = this._stateManager.format;
    return {
      bitsPerSample: f.bitsPerSample || 0,
      channelData: [],
      errors: [],
      sampleRate: f.sampleRate || 0,
      samplesDecoded: 0,
    };
  }

  private createErrorResult(msg: string): DecodedWavAudio {
    this._stateMachine.transition(DecoderState.ERROR);
    this._stateManager.setError(msg);
    const res = this.createEmptyResult();
    const allErrors = this.collectAllErrors();
    if (allErrors.length > 0) {
      res.errors.push(allErrors[allErrors.length - 1]!);
    }
    return res;
  }

  get blockAlign(): number {
    const { blockAlign, bitsPerSample, channels } = this._stateManager.format || {};
    if (blockAlign > 0) return blockAlign;
    if (Number.isInteger(bitsPerSample) && bitsPerSample > 0 && Number.isInteger(channels) && channels > 0) {
      return Math.floor((bitsPerSample / 8) * channels);
    }
    return 0;
  }

  get bytesPerSecond(): number {
    const { bytesPerSecond, sampleRate } = this._stateManager.format || {};
    const blockAlign = this.blockAlign;
    if (bytesPerSecond > 0) return bytesPerSecond;
    if (blockAlign > 0) {
      return sampleRate * blockAlign;
    }
    return 0;
  }

  get totalDuration(): number {
    const { format, estimatedSamples } = this._stateManager;
    if (!format?.sampleRate || format.sampleRate <= 0) return 0;
    return estimatedSamples / format.sampleRate;
  }

  get info(): WavDecoderInfo {
    const sm = this._stateManager;
    console.debug('info() fired', sm);
    return {
      state: this.state,
      format: sm.format,
      decodedBytes: sm.decodedBytes,
      remainingBytes: sm.remainingBytes,
      totalBytes: sm.totalBytes,
    };
  }

  get state() {
    return this._stateMachine.state;
  }

  get errors() {
    return this.collectAllErrors();
  }

  get progress(): number {
    return this._stateManager.progress;
  }

  get totalFrames(): number {
    return this._stateManager.estimatedSamples;
  }

  get available(): number {
    return this._ringBuffer.available;
  }

  get sampleRate(): number {
    return this._stateManager.format.sampleRate;
  }

  get channels(): number {
    return this._stateManager.format.channels;
  }

  get decodedBytes() {
    return this._stateManager.decodedBytes;
  }

  get bitsPerSample(): number {
    return this._stateManager.format.bitsPerSample;
  }
}
