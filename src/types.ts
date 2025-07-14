/**
 * Audio format tag values used in WAV files.
 * - 1 = PCM
 * - 3 = IEEE Float
 * - 6 = A-law
 * - 7 = µ-law
 * - 65534 = Extensible (used for non-standard formats)
 */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534 | (number & {});

/**
 * Supported bit depths. The `(number & {})` allows for any numeric value
 * while providing autocomplete for common bit depths.
 */
export type WavBitsPerSample = 8 | 16 | 24 | 32 | 64 | (number & {});

/**
 * Standard audio sample rates in Hz. The `(number & {})` allows for any numeric value
 * while providing autocomplete for common rates.
 */
export type CommonSampleRate =
  | 8000 | 11025 | 16000 | 22050 | 32000 | 44100 | 48000
  | 88200 | 96000 | 176400 | 192000
  | (number & {});

/**
 * Information about a decoding error encountered while processing a WAV file.
 */
export interface DecodeError {
  /** A descriptive message about the error. */
  message: string;
  /** The length of a single audio frame in bytes at the time of the error. */
  frameLength: number;
  /** The estimated frame number where the error occurred. */
  frameNumber: number;
  /** The total number of bytes processed before the error. */
  inputBytes: number;
}

/**
 * The result of a decode operation.
 */
export interface DecodedWavAudio {
  /** Array of Float32Arrays (one per channel) */
  channelData: Float32Array[];
  /** Number of samples decoded per channel */
  samplesDecoded: number;
  /** Sample rate in Hz */
  sampleRate: CommonSampleRate;
  /** Non-fatal errors encountered during decoding */
  errors: DecodeError[];
}

/**
 * WAV decoder configuration options.
 */
export interface DecoderOptions {
  /** Maximum ring buffer size in bytes (default: 16MB) */
  maxBufferSize?: number;
}

/**
 * Describes WAV file audio format.
 */
export interface WavFormat {
  /** Format tag (PCM, Float, etc.) */
  format: WavFormatTag;
  /** Number of audio channels */
  channelCount: number;
  /** Samples per second */
  sampleRate: CommonSampleRate;
  /** Data rate in bytes/second */
  bytesPerSecond: number;
  /** Block size in bytes */
  blockSize: number;
  /** Bits per sample */
  bitsPerSample: WavBitsPerSample;
  /** Size of extension area (if present) */
  extensionSize?: number;
  /** Valid bits per sample (if specified) */
  validBitsPerSample?: number;
  /** Speaker position mask */
  channelMask?: number;
  /** GUID of subformat */
  subFormat?: Uint8Array;
  /** Calculated duration in seconds */
  duration?: number;
}
