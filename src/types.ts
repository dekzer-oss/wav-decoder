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
 * Represents various states of a decoding process.
 *
 * The `DecoderState` enum is used to track and manage the current state
 * of a decoding operation. It helps ensure proper handling and transitions
 * during the decoding lifecycle.
 *
 * Enumerated Values:
 * - DECODING: Indicates that decoding is currently in progress.
 * - ENDED: Indicates that decoding has successfully completed.
 * - ERROR: Indicates that an error occurred during decoding.
 * - IDLE: Represents an uninitialized or default state, typically
 *   before decoding has started.
 */
export enum DecoderState {
  DECODING,
  ENDED,
  ERROR,
  IDLE,
}

/**
 * Represents the configuration options for a decoder.
 *
 * @interface DecoderOptions
 * @property {number} [maxBufferSize] - The maximum buffer size allowed for decoding. This property is optional.
 */
export interface DecoderOptions {
  bufferSize?: number;
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
  remainingBytes: number;
  state: DecoderState;
  totalBytes: number;
  unhandledChunks: ChunkInfo[];
}

/**
 * Interface representing a WAV decoder for handling audio data.
 */
export interface WavDecoderInterface {
  decode(chunk: Uint8Array): DecodedWavAudio;
  decodeFrame(frame: Uint8Array): Float32Array | null; // todo: refactor to return Float32Array (not null)
  decodeFrames(frames: Uint8Array): DecodedWavAudio; // todo: refactor to accept Uint8Array[]
  free(): void;
  flush(): DecodedWavAudio;
  info: WavDecoderInfo;
  reset(): void;
}

/**
 * Represents the WAV file format details.
 * This interface defines properties describing the structure
 * and properties of a WAV file.
 *
 * Properties:
 * - `bitDepth`: Specifies the number of bits used to represent each sample (e.g., 16, 24, 32 bits).
 * - `blockSize`: Defines the size in bytes of each block of audio data.
 * - `bytesPerSecond`: Indicates the average number of bytes processed per second of audio.
 * - `channels`: Number of audio channels (e.g., 1 for mono, 2 for stereo).
 * - `samplesPerBlock`: Specifies the number of audio samples contained in each block of data.
 * - `channelMask`: (Optional) Bit mask that specifies the mapping of channels to speaker positions.
 * - `extensionSize`: (Optional) Size of the optional format extension data section.
 * - `formatTag`: Describes the encoding format of the WAV file (e.g., PCM, IEEE Float).
 * - `sampleRate`: Number of audio samples per second (frequency in Hz).
 * - `subFormat`: (Optional) Subformat identifier in the form of a unique identifier (GUID).
 * - `validBitsPerSample`: (Optional) Indicates the number of valid bits used per sample, useful in certain extended formats.
 */
export interface WavFormat {
  bitDepth: WavBitDepth; // todo: rename to `bitsPerSample`
  blockSize: number;
  bytesPerSecond: number;
  channels: number;
  samplesPerBlock?: number;
  channelMask?: number;
  extensionSize?: number;
  formatTag: WavFormatTag;
  sampleRate: WavSampleRate;
  subFormat?: Uint8Array;
  validBitsPerSample?: number;
}

/**
 * Represents the result of a seek operation within an audio stream.
 *
 * It contains detailed information about the position reached after seeking,
 * which may not be an exact sample due to block alignment or other
 * encoding specifics.
 *
 * @interface DecoderSeekResult
 */
export interface DecoderSeekResult {
  /** Where to start reading (container/keyframe safe) */
  byteOffset: number;
  /** Decoder's sample rate (samples/sec) */
  nativeSampleRate: number;
  /** Requested time in seconds */
  requestedTime: number;
  /** Native sample at the container boundary we start decoding */
  anchorSample: number;
  /** Native samples to decode but not output (e.g., Opus preroll) */
  prerollSamples: number;
  /** Native samples to drop after preroll to land on request */
  discardSamples: number;
  /** Anchor + preroll + discard (native sample rate) */
  firstAudibleSample: number;
  /** Whether firstAudibleSample == requested time in native domain */
  isExact: boolean;
}
