/**
 * Represents the bit depth used in a WAV file.
 *
 * The bit depth specifies the number of bits of information
 * in each audio sample. Common bit depths include 8, 16, 24,
 * 32, and 64 bits, representing various levels of audio
 * quality and file size. The type also accepts any custom
 * numerical values.
 */
export type WavBitDepth = 8 | 16 | 24 | 32 | 64 | (number & {});

/**
 * Represents various WAVE file format tags, commonly used to identify the
 * audio coding type in a WAVE file header.
 *
 * The type supports specific well-known values in addition to extension possibilities with custom numeric values.
 *
 * - `1`: Linear PCM, uncompressed audio data.
 * - `3`: IEEE float, representing audio samples using 32-bit floating-point numbers.
 * - `6`: μ-law, a logarithmic compression encoding format.
 * - `7`: A-law, another logarithmic compression encoding format.
 * - `65534`: WAVE_FORMAT_EXTENSIBLE, a container supporting extensible format specifications.
 *
 * The type also allows other user-defined numerical identifiers represented as `(number & {})`.
 */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534 | (number & {});

/**
 * An object containing the mappings of WAV format tag identifiers to their respective human-readable names.
 * This object is defined as a constant and represents specific audio format types for WAV files.
 *
 * The keys are numeric identifiers corresponding to format tags, and the values are string descriptions of those formats:
 * - 1: Represents PCM (Pulse-Code Modulation), a standard audio format for uncompressed audio.
 * - 3: Represents IEEE Float, a format with floating-point samples.
 * - 6: Represents A-Law, a compression format used in telephony.
 * - 7: Represents µ-Law (Mu-Law), another telephony compression format.
 * - 65534: Represents Extensible, a format used to extend the capabilities of the WAV format.
 */
export const WavFormatTagNames = {
  1: 'PCM',
  3: 'IEEE Float',
  6: 'A-Law',
  7: 'µ-Law',
  65534: 'Extensible',
} as const;

/**
 * Represents the sample rate for a WAV audio file.
 *
 * The sample rate determines the number of samples of audio carried per second,
 * measured in Hz. Common sample rates are defined as specific numeric values,
 * but other custom numeric values are also permissible.
 *
 * Supported predefined sample rates:
 * - 8000 Hz
 * - 11025 Hz
 * - 16000 Hz
 * - 22050 Hz
 * - 32000 Hz
 * - 44100 Hz
 * - 48000 Hz
 * - 88200 Hz
 * - 96000 Hz
 * - 176400 Hz
 * - 192000 Hz
 *
 * Custom sample rates outside of these predefined values can also be used, represented as any valid number.
 */
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

/**
 * Represents information about a chunk of data.
 *
 * This interface is used to store metadata about a specific chunk,
 * including its unique identifier, starting position, and size.
 *
 * Properties:
 * - `id`: A unique identifier for the chunk.
 * - `offset`: The starting position of the chunk.
 * - `size`: The size of the chunk.
 */
export interface ChunkInfo {
  id: string;
  offset: number;
  size: number;
}

/**
 * Represents an error that occurs during the decoding process.
 *
 * This interface is used to describe the details of a decoding error, including
 * information about the frame where the error occurred, related input/output
 * data, and an error message.
 *
 * Properties:
 * - `frameLength`: The length of the affected frame in the decoding process.
 * - `frameNumber`: The number of the frame where the error occurred.
 * - `inputBytes`: The number of bytes from the input that were processed when the error happened.
 * - `message`: A descriptive message providing details about the error.
 * - `outputSamples`: The number of output samples that were generated prior to the error.
 */
export interface DecodeError {
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  message: string;
  outputSamples: number;
}

/**
 * Represents the structure of decoded WAV audio data.
 *
 * This interface provides detailed information about a WAV audio file after decoding,
 * including its metadata and audio content.
 *
 * Properties:
 * - `bitDepth`: The number of bits used to represent each audio sample.
 * - `channelData`: An array containing Float32Array objects where each array represents the audio data for a channel.
 * - `errors`: An array of decoding errors, if any, encountered during the decoding process.
 * - `sampleRate`: The number of samples per second of the audio (hertz).
 * - `samplesDecoded`: The total number of audio samples decoded from the file.
 */
export interface DecodedWavAudio {
  bitDepth: WavBitDepth;
  channelData: Float32Array[];
  errors: DecodeError[];
  sampleRate: WavSampleRate;
  samplesDecoded: number;
}

/**
 * Represents the current state of a decoding operation.
 *
 * This enum tracks the decoder lifecycle and helps coordinate behavior
 * such as buffering, resetting, or error handling.
 */
export enum DecoderState {
  /**
   * Decoder is idle and ready, but decoding has not yet begun.
   */
  IDLE,

  /**
   * Decoding is currently in progress.
   */
  DECODING,

  /**
   * Decoding has completed successfully and reached the end of stream.
   */
  ENDED,

  /**
   * An error occurred during decoding.
   */
  ERROR,
}

/**
 * Represents the configuration options for a decoder.
 *
 * @interface DecoderOptions
 * @property {number} [maxBufferSize] - The maximum buffer size allowed for decoding. This property is optional.
 */
export interface DecoderOptions {
  maxBufferSize?: number;
}

/**
 * Represents metadata and progress details of a WAV decoding operation.
 *
 * @interface WavDecoderInfo
 *
 * @property {number} decodedBytes - The total number of bytes successfully decoded.
 *
 * @property {DecodeError[]} errors - An array of decoding errors that occurred during the process.
 *
 * @property {WavFormat} format - The format information of the WAV file being decoded.
 *
 * @property {number} formatTag - The format tag that specifies the audio format.
 *
 * @property {ChunkInfo[]} parsedChunks - An array of information objects for parsed chunks in the WAV data.
 *
 * @property {number} progress - The decoding progress expressed as a percentage.
 *
 * @property {number} remainingBytes - The number of bytes yet to be decoded.
 *
 * @property {DecoderState} state - The current state of the decoding operation.
 *
 * @property {number} totalBytes - The total size in bytes of the WAV file being processed.
 *
 * @property {number} totalDuration - The total duration of the WAV file in seconds.
 *
 * @property {ChunkInfo[]} unhandledChunks - An array of chunks that were detected but not processed.
 */
export interface WavDecoderInfo {
  decodedBytes: number;
  errors: DecodeError[];
  format: WavFormat;
  parsedChunks: ChunkInfo[];
  progress: number;
  remainingBytes: number;
  state: DecoderState;
  totalBytes: number;
  totalDuration: number;
  unhandledChunks: ChunkInfo[];
}

/**
 * Interface representing a WAV decoder for handling audio data.
 */
export interface WavAudioDecoder {
  decode(chunk: Uint8Array): DecodedWavAudio;

  free(): void;

  flush(): DecodedWavAudio;

  reset(): void;

  info: WavDecoderInfo;
}

/**
 * Describes the format details of a WAV (RIFF) audio stream.
 * This structure defines how the audio data is encoded, including
 * sample resolution, channel layout, and data alignment.
 *
 * Properties:
 * - `bitDepth`: Number of bits used to represent each channel sample (e.g., 8, 16, 24, 32).
 * - `blockAlign`: Number of bytes per sample frame (1 sample from each channel). Must equal `channels × bitDepth / 8`.
 *                Used to align audio frames in the data chunk.
 * - `bytesPerSecond`: Average byte rate of the audio stream. Calculated as `sampleRate × blockAlign`.
 * - `channels`: Number of audio channels (e.g., 1 = mono, 2 = stereo, etc.).
 * - `samplesPerBlock`: For compressed formats (e.g., IMA ADPCM), indicates how many decoded PCM samples are produced per block.
 *                      Maybe zero for uncompressed formats like PCM or IEEE float.
 * - `channelMask`: (Optional) Bitmask indicating speaker positions (used with WAVE_FORMAT_EXTENSIBLE).
 * - `extensionSize`: (Optional) Number of extra bytes following the standard format header (e.g., 22 for WAVE_FORMAT_EXTENSIBLE).
 * - `formatTag`: Numeric identifier of the audio format (e.g., `0x0001` = PCM, `0x0003` = IEEE float, `0xfffe` = extensible).
 * - `sampleRate`: Number of samples per second per channel (Hz).
 * - `subFormat`: (Optional) 16-byte GUID used with WAVE_FORMAT_EXTENSIBLE to identify the precise format.
 * - `validBitsPerSample`: (Optional) Actual number of valid bits per sample when `bitDepth` includes padding (e.g., 20-bit audio in 24-bit container).
 */
export interface WavFormat {
  bitDepth: WavBitDepth;
  blockAlign: number;
  bytesPerSecond: number;
  channels: number;
  samplesPerBlock: number;
  channelMask?: number;
  extensionSize?: number;
  formatTag: WavFormatTag;
  sampleRate: WavSampleRate;
  subFormat?: Uint8Array;
  validBitsPerSample?: number;
  dataChunkOffset?: number;
  dataChunkSize?: number;
}
