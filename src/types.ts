/**
 * The number of bits of information in each audio sample.
 * Common values are 8, 16, 24, 32, and 64.
 */
export type WavBitDepth = 8 | 16 | 24 | 32 | 64 | (number & {});

/**
 * Identifier for the audio encoding format in a WAVE file header.
 * - `1`: PCM (uncompressed)
 * - `3`: IEEE Float
 * - `6`: A-law (logarithmic compression)
 * - `7`: μ-law (logarithmic compression)
 * - `65534`: Extensible format
 */
export type WavFormatTag = 1 | 3 | 6 | 7 | 65534 | (number & {});

/**
 * A constant mapping of WAV format tag identifiers to their human-readable names.
 */
export const WavFormatTagNames = {
  1: 'PCM',
  3: 'IEEE Float',
  6: 'A-Law',
  7: 'µ-Law',
  65534: 'Extensible',
} as const;

/**
 * The number of audio samples per second (in Hertz).
 * Common values include 8000, 11025, 22050, 44100, and 48000.
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
 * Metadata for a single chunk within a WAV file.
 * @property id - The unique four-character identifier of the chunk (e.g., 'fmt ', 'data').
 * @property offset - The starting byte position of the chunk in the file.
 * @property size - The size of the chunk's data section in bytes.
 */
export interface ChunkInfo {
  id: string;
  offset: number;
  size: number;
}

/**
 * Describes an error that occurred during the decoding process.
 * @property frameLength - The length of the audio frame where the error occurred.
 * @property frameNumber - The index of the frame where the error occurred.
 * @property inputBytes - The total number of bytes processed before the error.
 * @property message - A descriptive message explaining the error.
 * @property outputSamples - The number of samples successfully decoded before the error.
 */
export interface DecodeError {
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  message: string;
  outputSamples: number;
}

/**
 * The fully decoded audio data and its associated metadata.
 * @property bitsPerSample - The number of bits used to represent each audio sample.
 * @property channelData - An array of `Float32Array`, where each array holds the audio data for a single channel.
 * @property errors - A list of any errors encountered during decoding.
 * @property sampleRate - The number of samples per second of the audio.
 * @property samplesDecoded - The total number of audio samples successfully decoded.
 */
export interface DecodedWavAudio {
  bitsPerSample: WavBitDepth;
  channelData: Float32Array[];
  errors: DecodeError[];
  sampleRate: WavSampleRate;
  samplesDecoded: number;
}

/**
 * Represents the lifecycle state of the decoder.
 * @enum {number}
 * @property DECODING - The decoder is actively processing data.
 * @property ENDED - The decoding process has completed successfully.
 * @property ERROR - An unrecoverable error has occurred during decoding.
 * @property IDLE - The decoder is initialized but has not yet processed any data.
 */
export enum DecoderState {
  DECODING,
  ENDED,
  ERROR,
  IDLE,
}

/**
 * Configuration options for the WavDecoder.
 * @property bufferSize - The initial size of the internal ring buffer in bytes. Must be a power of two.
 */
export interface DecoderOptions {
  bufferSize?: number;
}

/**
 * Provides detailed metadata and progress information about the decoding process.
 * @property decodedBytes - The total number of bytes successfully decoded so far.
 * @property errors - A list of all non-fatal errors that have occurred.
 * @property format - The parsed format information of the WAV file.
 * @property parsedChunks - A list of all chunks that have been successfully parsed from the header.
 * @property remainingBytes - The number of bytes yet to be decoded from the data chunk.
 * @property state - The current lifecycle state of the decoder.
 * @property totalBytes - The total size in bytes of the audio data chunk.
 * @property unhandledChunks - A list of chunks that were found in the header but not processed.
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
 * Defines the public interface for a WAV audio decoder.
 */
export interface Decoder {
  /** Current metadata and progress of the decoding operation. */
  info: WavDecoderInfo;

  /**
   * Decodes a chunk of WAV file data. This method handles both header parsing and audio data decoding.
   * @param chunk - A `Uint8Array` containing a piece of the WAV file.
   * @returns A `DecodedWavAudio` object containing the decoded channel data and metadata.
   */
  decode(chunk: Uint8Array): DecodedWavAudio;

  /**
   * Decodes a single, complete audio frame.
   * @param frame - A `Uint8Array` representing one audio frame. Its length must match `format.blockAlign`.
   * @returns A `Float32Array` containing the de-interleaved sample data for the frame.
   * @throws Will throw an error if the decoder is not in the correct state, the frame length is invalid, or the format is unsupported.
   */
  decodeFrame(frame: Uint8Array): Float32Array;

  /**
   * Decodes an array of complete audio frames.
   * @param frames - An array of `Uint8Array`, where each element is a single audio frame.
   * @returns A `DecodedWavAudio` object containing the combined decoded channel data.
   */
  decodeFrames(frames: Uint8Array[]): DecodedWavAudio;

  /** Releases internal buffers and puts the decoder in an unusable `ENDED` state. */
  free(): void;

  /**
   * Processes any remaining data in the buffer and finalizes the decoding.
   * @returns A `DecodedWavAudio` object with any remaining samples.
   */
  flush(): DecodedWavAudio;

  /** Resets the decoder to its initial `IDLE` state, ready to process a new file. */
  reset(): void;
}

/**
 * Describes the detailed format of a WAV file, parsed from the `fmt` chunk.
 * @property bitsPerSample - The number of bits per audio sample (e.g., 16, 24).
 * @property blockAlign - The size in bytes of a single audio frame across all channels (`channels * bitsPerSample / 8`).
 * @property avgBytesPerSec - The average byte rate of the audio stream (`sampleRate * blockAlign`).
 * @property channels - The number of audio channels (1 for mono, 2 for stereo).
 * @property samplesPerBlock - The number of samples in each block of a compressed format (e.g., IMA ADPCM).
 * @property channelMask - (Optional) Bitmask specifying the speaker layout for multichannel audio.
 * @property extensionSize - (Optional) The size of the format extension.
 * @property formatTag - The numeric code for the audio format (e.g., PCM, IEEE Float).
 * @property sampleRate - The number of samples per second (in Hertz).
 * @property subFormat - (Optional) A GUID specifying the sub-format, used with `WAVE_FORMAT_EXTENSIBLE`.
 * @property validBitsPerSample - (Optional) The actual number of valid bits in a sample (e.g., 20 for a 24-bit sample).
 */
export interface WavFormat {
  bitsPerSample: WavBitDepth;
  blockAlign: number;
  avgBytesPerSec: number;
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
 * The result of a seek operation, providing the necessary details to resume decoding from a new position.
 * @property byteOffset - The exact byte offset in the audio stream to begin reading from.
 * @property nativeSampleRate - The sample rate of the decoder.
 * @property requestedTime - The original time in seconds that was requested for the seek.
 * @property anchorSample - The keyframe or block-aligned sample number that decoding will start from.
 * @property prerollSamples - The number of samples to decode but discard to prime the decoder (e.g., Opus preroll).
 * @property discardSamples - The number of samples to discard after the preroll to align with the requested time.
 * @property firstAudibleSample - The final sample number that will be the first one heard by the user.
 * @property isExact - A boolean indicating if the `firstAudibleSample` perfectly matches the `requestedTime`.
 */
export interface DecoderSeekResult {
  byteOffset: number;
  nativeSampleRate: number;
  requestedTime: number;
  anchorSample: number;
  prerollSamples: number;
  discardSamples: number;
  firstAudibleSample: number;
  isExact: boolean;
}
