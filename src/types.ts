import { DecoderState } from './core/StateMachine.ts';

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
  state: DecoderState;
  format: WavFormat;
  decodedBytes: number;
  remainingBytes: number;
  totalBytes: number;
  // parsedChunks: DataChunk[];
  // unhandledChunks: DataChunk[];
}

/**
 * Main universal streaming audio decoder interface for WAV and beyond.
 * All properties are always up-to-date and “live”.
 */
export interface AudioDecoder {
  /** Incrementally decode a chunk of audio data (Uint8Array or Buffer). */
  decode(chunk: Uint8Array): DecodedWavAudio;

  /** Flush remaining buffered data and finalize decoding. */
  flush(): DecodedWavAudio;

  /** Reset decoder state for a new stream/file. */
  reset(): void;

  /** Release all buffers/resources for GC. */
  free(): void;

  /** Current decoder state (IDLE, DECODING, ENDED, ERROR). */
  state: DecoderState;

  /** Info about the decoder and file. Always up-to-date. */
  readonly info: WavDecoderInfo;

  /** Progress as a 0..1 fraction. */
  readonly progress: number;

  /** Total duration in seconds (if known). */
  readonly totalDuration: number;

  /** Total number of audio frames (if known). */
  readonly totalFrames: number;

  /** Sample rate in Hz. */
  readonly sampleRate: number;

  /** Number of audio channels. */
  readonly channels: number;

  /** Bit depth (bits per sample). */
  readonly bitsPerSample: number;

  /** Any errors or warnings encountered so far. */
  readonly errors: DecodeError[];

  /** Bytes available in streamBuffer (audio data, not header). */
  readonly available: number;

  /** Total number of bytes decoded. */
  readonly decodedBytes: number;

  /**
   * Async streaming API: yields DecodedWavAudio as data arrives.
   * Accepts ReadableStream<Uint8Array> (browser) or Node stream.Readable.
   */
  stream?(input: ReadableStream<Uint8Array> | NodeJS.ReadableStream): AsyncIterableIterator<DecodedWavAudio>;

  /**
   * Node/CLI convenience: decode a whole file at once.
   * Accepts a file path or Buffer (Node only).
   */
  decodeFile?(file: string | Buffer): Promise<DecodedWavAudio>;

  /**
   * Static helper: returns true if a WAVE format tag is supported.
   */
  supports(formatTag: number): boolean;

  /**
   * Pure, stateless function: parse and introspect any WAV header.
   */
  parseHeader(header: Uint8Array): WavHeaderParserResult;
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
 * @property {number} [extSize] - Size in bytes of extra extension fields.
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
  validBitsPerSample?: number;
  subFormat?: Uint8Array;
  extSize?: number;
  extraFields?: Uint8Array;

  // --- Runtime fields, always optional
  resolvedFormatTag?: number;
  isLittleEndian?: boolean;
  bytesPerSample?: number;
  factChunkSamples?: number;
  dataChunks?: DataChunk[];
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
 * @property {number} totalFrames - Total frame count (multichannel).
 * @property {number} duration - Duration in seconds (float).
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
  errors: string[];
}

export type AudioChunk = Uint8Array | Buffer;
export type InputStream = ReadableStream<Uint8Array> | NodeJS.ReadableStream;
export type InputFile = string | Buffer;
