/** Typical bit-depths; accepts any number. */
export type WavBitDepth = 8 | 16 | 24 | 32 | 64 | (number & {});

/** RIFF “fmt ” tag – 1 = PCM, 3 = float, 6 = A-law, 7 = µ-law, 65534 = extensible. */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534 | (number & {});

/** Common sample-rates (Hz); accepts any number. */
export type WavSampleRate =
  | 8000
  | 11025
  | 16000
  | 22050
  | 32000
  | 44100
  | 48000
  | 88200
  | 96000
  | 176400
  | 192000
  | (number & {});

export interface ChunkInfo {
  id: string;
  offset: number;
  size: number;
}

export interface DecodeError {
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  message: string;
  outputSamples: number;
}

export interface DecodedWavAudio {
  bitDepth: WavBitDepth;
  channelData: Float32Array[];
  duration: number;
  errors: DecodeError[];
  sampleRate: WavSampleRate;
  samplesDecoded: number;
}

export enum DecoderState {
  DECODING,
  ENDED,
  ERROR,
  UNINIT,
}

export interface DecoderOptions {
  maxBufferSize?: number;
}

export interface WavDecoderInfo {
  decodedBytes: number;
  errors: DecodeError[];
  format: WavFormat;
  formatTag: number;
  parsedChunks: ChunkInfo[];
  progress: number;
  remainingBytes: number;
  state: DecoderState;
  totalBytes: number;
  totalDuration: number;
  unhandledChunks: ChunkInfo[];
}

export interface WavDecoderInterface {
  decode(chunk: Uint8Array): DecodedWavAudio;
  decodeFrame(frame: Uint8Array): Float32Array | null;
  decodeFrames(frames: Uint8Array): DecodedWavAudio;
  free(): void;
  flush(): DecodedWavAudio;
  info: WavDecoderInfo;
  reset(): void;
}

export interface WavFormat {
  bitDepth: WavBitDepth;
  blockSize: number;
  bytesPerSecond: number;
  channels: number;
  samplesPerBlock: number;
  channelMask?: number;
  extensionSize?: number;
  formatTag: WavFormatTag;
  sampleRate: WavSampleRate;
  subFormat?: Uint8Array;
  validBitsPerSample?: number;
}
