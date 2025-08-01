import { type DecodeError, DecoderState, type WavFormat } from '../types.ts';

/**
 * Manages the lifecycle state and progress statistics of the decoder.
 */
export class StateManager {
  public state = DecoderState.UNINIT;
  public decodedBytes = 0;
  public remainingBytes = 0;
  public totalBytes = 0;
  public factChunkSamples = 0;
  public format = {} as WavFormat;
  public errors: DecodeError[] = [];

  public get progress(): number {
    if (this.totalBytes === 0) return 0;
    return (this.totalBytes - this.remainingBytes) / this.totalBytes;
  }

  public get estimatedSamples(): number {
    if (this.factChunkSamples > 0) return this.factChunkSamples;
    if (this.totalBytes > 0 && this.format.blockSize > 0) {
      if (this.format.formatTag === 0x0011 /* IMA_ADPCM */) {
        const blocks = Math.floor(this.totalBytes / this.format.blockSize);
        return blocks * (this.format.samplesPerBlock ?? 0);
      }
      return Math.floor(this.totalBytes / this.format.blockSize);
    }
    return 0;
  }

  public initialize(format: WavFormat, dataChunkSize: number, factSamples: number): void {
    this.format = format;
    this.totalBytes = this.remainingBytes = dataChunkSize;
    this.factChunkSamples = factSamples;
    this.state = DecoderState.DECODING;
  }

  public updateProgress(bytesProcessed: number): void {
    this.decodedBytes += bytesProcessed;
    this.remainingBytes = Math.max(0, this.remainingBytes - bytesProcessed);
  }

  public reset(): void {
    this.state = DecoderState.UNINIT;
    this.decodedBytes = 0;
    this.remainingBytes = 0;
    this.totalBytes = 0;
    this.factChunkSamples = 0;
    this.format = {} as WavFormat;
    this.errors = [];
  }

  public end(): void {
    if (this.state !== DecoderState.ERROR) {
      this.state = DecoderState.ENDED;
    }
  }

  public error(): void {
    this.state = DecoderState.ERROR;
  }
}
