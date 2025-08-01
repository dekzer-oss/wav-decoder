/**
 * Represents the bit depth used in a WAV file.
 *
 * The bit depth specifies the number of bits of information
 * in each audio sample. Common bit depths include 8, 16, 24,
 * 32, and 64 bits, representing various levels of audio
 * quality and file size. The type also accepts any custom
 * numerical values.
 */
export type WavBitsPerSample = 4 | 8 | 12 | 16 | 20 | 24 | 32 | 64 | (number & {});

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
export interface DataChunk {
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
 * - `bitsPerSample`: The number of bits used to represent each audio sample.
 * - `channelData`: An array containing Float32Array objects where each array represents the audio data for a channel.
 * - `errors`: An array of decoding errors, if any, encountered during the decoding process.
 * - `sampleRate`: The number of samples per second of the audio (hertz).
 * - `samplesDecoded`: The total number of audio samples decoded from the file.
 */
export interface DecodedWavAudio {
  bitsPerSample: WavBitsPerSample;
  channelData: Float32Array[];
  sampleRate: WavSampleRate;
  samplesDecoded: number;
  errors: DecodeError[];
  warnings: string[];
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
  historySize?: number;
}

/**
 * Provides detailed metadata and diagnostic information about the WAV decoder state and process.
 *
 * @property {number} decodedBytes - Total number of audio bytes successfully decoded so far.
 * @property {DecodeError[]} errors - List of non-fatal and fatal decoding errors encountered.
 * @property {WavFormat} format - Resolved format details for the decoded WAV stream.
 * @property {DataChunk[]} parsedChunks - All chunks parsed and recognized during header analysis.
 * @property {number} remainingBytes - Bytes still expected or pending in the main audio data.
 * @property {DecoderState} state - Current state of the decoder lifecycle.
 * @property {number} totalBytes - Total length of the audio data (if known).
 * @property {DataChunk[]} unhandledChunks - Chunks found in the file but not processed by the decoder.
 */
export interface WavDecoderInfo {
  decodedBytes: number;
  errors: DecodeError[];
  format: WavFormat;
  parsedChunks: DataChunk[];
  remainingBytes: number;
  state: DecoderState;
  totalBytes: number;
  unhandledChunks: DataChunk[];
}

/**
 * Interface representing a generic streaming-capable WAV audio decoder.
 *
 * @interface AudioDecoder
 * @method decode - Incrementally decodes the given chunk of WAV data, returning decoded audio.
 * @method decodeFrame - Decodes a single frame of audio data into floating-point samples.
 * @method decodeFrames - Decodes a batch of frames (array of Uint8Array) in one call.
 * @method free - Releases internal resources/buffers held by the decoder.
 * @method flush - Finalizes decoding and flushes any remaining buffered audio.
 * @property info - Exposes diagnostic information and decoder status.
 * @method reset - Resets the decoder to its initial state for reuse.
 */
export interface AudioDecoder {
  decode(chunk: Uint8Array): DecodedWavAudio;
  decodeFrame(frame: Uint8Array): Float32Array;
  decodeFrames(frames: Uint8Array[]): DecodedWavAudio;
  free(): void;
  flush(): DecodedWavAudio;
  info: WavDecoderInfo;
  reset(): void;
}

/**
 * Represents the core format properties of a WAV file, as parsed from the 'fmt ' chunk and extensions.
 *
 * @property {number} bitsPerSample - Number of bits per audio sample.
 * @property {number} blockAlign - Number of bytes per sample frame (all channels).
 * @property {number} bytesPerSecond - Average data rate of the audio stream (for buffer sizing).
 * @property {number} channels - Number of audio channels (1 = mono, 2 = stereo, etc.).
 * @property {number} formatTag - WAVE format code (e.g., 1 = PCM, 3 = IEEE float).
 * @property {number} sampleRate - Sample rate in Hz.
 * @property {number} [samplesPerBlock] - Samples per block (used by some compressed formats).
 * @property {number} [channelMask] - Channel layout bitmask (WAVEFORMATEXTENSIBLE).
 * @property {number} [extensionSize] - Size in bytes of extra extension fields.
 * @property {Uint8Array} [subFormat] - Sub-format GUID for extensible WAV formats.
 * @property {number} [validBitsPerSample] - Actual valid bits per sample (for extensible formats).
 * @property {number} [extSize] - Extension field size.
 * @property {Uint8Array} [extraFields] - Any other extension bytes not covered above.
 */
export interface WavFormat {
  bitsPerSample: number;
  blockAlign: number;
  bytesPerSecond: number;
  channels: number;
  formatTag: number;
  sampleRate: number;
  samplesPerBlock?: number;
  channelMask?: number;
  extensionSize?: number;
  subFormat?: Uint8Array;
  validBitsPerSample?: number;
  extSize?: number;
  extraFields?: Uint8Array;
}

/**
 * An extended version of WavFormat that includes internal decoder metadata and resolved fields.
 *
 * @property {number} factChunkSamples - If present, sample count reported in 'fact' chunk.
 * @property {DataChunk[]} dataChunks - All 'data' chunks located in the WAV file.
 * @property {boolean} isLittleEndian - Endianness of the parsed file (true = little-endian).
 * @property {number} resolvedFormatTag - Final format tag, resolved from extensible formats if needed.
 * @property {number} bytesPerSample - Number of bytes per channel per sample, after resolving the format.
 */
export interface ExtendedWavFormat extends WavFormat {
  factChunkSamples: number;
  dataChunks: DataChunk[];
  isLittleEndian: boolean;
  resolvedFormatTag: number;
  bytesPerSample: number;
}

/**
 * Result structure returned by parseWavHeader, containing the parsed WAV file structure, chunks, and any issues.
 *
 * @property {boolean} isLittleEndian - File endianness (little vs big/RIFX).
 * @property {WavFormat|null} format - Parsed format, or null if not found/invalid.
 * @property {boolean} isExtensible - Whether the file uses WAVE_FORMAT_EXTENSIBLE.
 * @property {number} dataBytes - Total length in bytes of audio data found in the file.
 * @property {number} dataOffset - Byte offset of the main data chunk.
 * @property {DataChunk[]} dataChunks - All recognized 'data' chunks.
 * @property {DataChunk[]} parsedChunks - All recognized and parsed chunks (headers and data).
 * @property {DataChunk[]} unhandledChunks - Chunks seen in the file but not parsed or handled.
 * @property {number} totalSamples - Total sample count, if calculable.
 * @property {number} totalFrames - Total frame count (multi-channel).
 * @property {number} duration - Duration in seconds (float).
 * @property {string[]} warnings - Any parsing warnings encountered (non-fatal).
 * @property {string[]} errors - Any fatal parsing errors encountered.
 */
export interface WavHeaderParserResult {
  format: WavFormat | null;
  isLittleEndian: boolean;
  isExtensible: boolean;
  dataBytes: number;
  dataOffset: number;
  dataChunks: DataChunk[];
  parsedChunks: DataChunk[];
  unhandledChunks: DataChunk[];
  totalSamples: number;
  totalFrames: number;
  duration: number;
  warnings: string[];
  errors: string[];
}
