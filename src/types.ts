/** RIFF “fmt ” tag – 1 = PCM, 3 = float, 6 = A-law, 7 = µ-law, 65534 = extensible. */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534 | (number & {});

/** Typical bit-depths; accepts any number. */
export type WavBitDepth = 8 | 16 | 24 | 32 | 64 | (number & {});

/** Common sample-rates (Hz); accepts any number. */
export type CommonSampleRate =
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

/* ---------- runtime structures ---------- */

export interface DecodeError {
  message: string;
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  outputSamples: number;
}

export interface DecodedWavAudio {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: CommonSampleRate;
  bitDepth: WavBitDepth;
  duration: number;
  errors: DecodeError[];
}

export interface DecoderOptions {
  maxBufferSize?: number;
}

/* ---------- header summary ---------- */

export interface WavFormat {
  formatTag: WavFormatTag;
  channels: number;
  sampleRate: CommonSampleRate;
  bytesPerSecond: number;
  blockSize: number;
  bitDepth: WavBitDepth;

  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subFormat?: Uint8Array;
  duration?: number;
}

/* ---------- decoder bookkeeping ---------- */

export enum DecoderState {
  UNINIT,
  DECODING,
  ENDED,
  ERROR,
}

export interface ChunkInfo {
  id: string;
  size: number;
  offset: number;
}

export interface WavDecoderInfo {
  state: DecoderState;
  formatTag: number;
  decodedBytes: number;
  remainingBytes: number;
  totalBytes: number;
  progress: number;
  format: WavFormat;
  errors: DecodeError[];
  parsedChunks: ChunkInfo[];
  unhandledChunks: ChunkInfo[];
  duration: number; // seconds decoded so far <-- ? is this true?
}
