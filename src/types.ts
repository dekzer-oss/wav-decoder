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
  message: string; // brief description
  frameLength: number; // bytes in one frame
  frameNumber: number; // index of bad frame
  inputBytes: number; // bytes read so far
  outputSamples: number; // samples produced so far
}

export interface DecodedWavAudio {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: CommonSampleRate;
  bitDepth: WavBitDepth;
  duration: number; // seconds
  errors: DecodeError[];
}

export interface DecoderOptions {
  maxBufferSize?: number; // default 16 MiB
}

/* ---------- header summary ---------- */

export interface WavFormat {
  formatTag: WavFormatTag;
  channels: number;
  sampleRate: CommonSampleRate;
  bytesPerSecond: number;
  blockSize: number;
  bitDepth: WavBitDepth;

  /* optional fields (extensible) */
  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subFormat?: Uint8Array;
  duration?: number; // seconds (file-level)
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
  progress: number; // 0–1
  format: WavFormat;
  errors: DecodeError[];
  parsedChunks: ChunkInfo[];
  unhandledChunks: ChunkInfo[];
  duration: number; // seconds decoded so far
}
