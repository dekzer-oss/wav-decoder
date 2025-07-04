/**
 * Audio format tag values used in WAV files.
 * - 1 = PCM
 * - 3 = IEEE Float
 * - 6 = A-law
 * - 7 = µ-law
 * - 65534 = Extensible (used for non-standard formats)
 */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534;

/**
 * Common bit depths used in WAV files.
 */
export type WavBitsPerSample = 8 | 16 | 24 | 32 | 64;

/**
 * Standard audio sample rates in Hz. The `(number & {})` allows for any numeric value
 * while still providing autocomplete for common rates.
 */
export type CommonSampleRate = 8000 | 16000 | 22050 | 44100 | 48000 | 96000 | 192000;

/**
 * Specific error codes for better programmatic error handling.
 */
export type DecodeErrorCode =
  | 'USER_ABORT'
  | 'DECODER_TERMINATED'
  | 'FILE_READ_ERROR'
  | 'HEADER_TOO_LARGE'
  | 'INVALID_HEADER'
  | 'INVALID_FORMAT_CHUNK'
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_CHANNELS'
  | 'UNSUPPORTED_SAMPLERATE'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_BIT_DEPTH'
  | 'INVALID_BLOCK_ALIGN'
  | 'INVALID_BYTE_RATE'
  | 'BUFFER_FULL'
  | 'DECODING_ERROR'
  | 'INCOMPLETE_FRAME_PADDED';

/**
 * Information about a decoding error encountered while processing a WAV file.
 */
export interface DecodeError {
  /** A descriptive message about the error. */
  message: string;
  /** A machine-readable code for the specific error. */
  code: DecodeErrorCode;
  /** The length of a single audio frame (block align) in bytes at the time of the error. */
  frameLength: number;
  /** The estimated frame number where the error occurred. */
  frameNumber: number;
  /** The total number of bytes processed from the input stream before the error. */
  inputBytes: number;
}

/**
 * The result of a successful decode operation, containing the audio data.
 */
export interface DecodedWavAudio {
  /** An array of Float32Arrays, one for each audio channel. */
  channelData: Float32Array[];
  /** The total number of samples decoded per channel. */
  samplesDecoded: number;
  /** The sample rate of the decoded audio in Hz. */
  sampleRate: CommonSampleRate | (number & {});
  /** An array of non-fatal errors encountered during decoding. */
  errors: DecodeError[];
}

/**
 * Options for configuring the WavDecoder instance upon creation.
 */
export interface DecoderOptions {
  /** The maximum size of the internal ring buffer in bytes. Defaults to 16MB. */
  maxBufferSize?: number;
  /** If true, the decoder will output a single interleaved Float32Array instead of separate channels. Defaults to false. */
  interleaved?: boolean;
}

/**
 * Options for the `decodeFile` method.
 */
export interface DecodeFileOptions {
  /** The size of the file chunks to read in bytes. Defaults to 1MB. */
  chunkSize?: number;
  /** A callback function to report decoding progress, receiving a value from 0.0 to 1.0. */
  onProgress?: (progress: number) => void;
}

/**
 * Describes the audio format of the WAV file.
 */
export interface WavFormat {
  format: WavFormatTag | (number & {});
  numChannels: number;
  sampleRate: CommonSampleRate | (number & {});
  byteRate: number;
  blockAlign: number;
  bitsPerSample: WavBitsPerSample | (number & {});
  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subFormat?: Uint8Array;
}
