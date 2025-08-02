import { type DecodeError, type WavFormat } from '../types';
import { DecoderState } from './StateMachine';
import { WAVE_FORMAT_IMA_ADPCM } from '../constants';

/**
 * Manages the lifecycle state and progress statistics of the decoder.
 */
export class StateManager {
  public state = DecoderState.IDLE;
  public decodedBytes = 0;
  public remainingBytes = 0;
  public totalBytes = 0;
  public factChunkSamples = 0;
  public format = {} as WavFormat;
  public errors: DecodeError[] = [];
  public headerParsed = false;
  public headerBuffer = new Uint8Array(0);

  get progress(): number {
    if (this.totalBytes === 0) return 0;
    return (this.totalBytes - this.remainingBytes) / this.totalBytes;
  }

  get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockAlign > 0) {
      if (this.format.formatTag === WAVE_FORMAT_IMA_ADPCM) {
        const blocks = Math.floor(this.totalBytes / this.format.blockAlign);
        return blocks * (this.format.samplesPerBlock ?? 0);
      }
      return Math.floor(this.totalBytes / this.format.blockAlign);
    }
    return 0;
  }

  public initialize(format: WavFormat, dataChunkSize: number, factSamples: number): void {
    this.format = format;
    this.totalBytes = this.remainingBytes = dataChunkSize;
    this.factChunkSamples = factSamples;
    this.state = DecoderState.DECODING;
    this.headerParsed = true;
    this.decodedBytes = 0;
  }

  public appendHeader(chunk: Uint8Array): void {
    const prev = this.headerBuffer;
    this.headerBuffer = new Uint8Array(prev.length + chunk.length);
    this.headerBuffer.set(prev, 0);
    this.headerBuffer.set(chunk, prev.length);
  }

  public updateProgress(bytesProcessed: number): void {
    this.decodedBytes += bytesProcessed;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytesProcessed);
  }

  public setError(message: string): void {
    this.state = DecoderState.ERROR;
    this.errors.push({
      frameLength: 0,
      frameNumber: 0,
      inputBytes: 0,
      message,
      outputSamples: 0,
    });
  }

  public reset(): void {
    this.state = DecoderState.IDLE;
    this.decodedBytes = 0;
    this.remainingBytes = 0;
    this.totalBytes = 0;
    this.factChunkSamples = 0;
    this.format = {} as WavFormat;
    this.errors = [];
    this.headerParsed = false;
    this.headerBuffer = new Uint8Array(0);
  }

  public end(): void {
    if (this.state !== DecoderState.ERROR) {
      this.state = DecoderState.ENDED;
    }
  }
}
