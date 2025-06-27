// Format tag values: 1 = PCM, 3 = IEEE Float, 6 = A-law, 7 = µ-law, 65534 = Extensible
export type WaveFormatTag = 1 | 3 | 6 | 7 | 65534;

export type WaveBitsPerSample = 8 | 16 | 24 | 32 | 64;

export type CommonSampleRate = 8000 | 16000 | 22050 | 44100 | 48000 | 96000;

type Integer = number;

export interface DecodeError {
  message: string;
  /** Size of the audio block that failed in bytes. */
  blockSize: Integer;
  /** The block index where the error occurred, starting from 0. */
  blockNumber: Integer;
  /** Total bytes processed up to the error. */
  inputBytes: Integer;
  /** Total samples decoded before the error. */
  outputSamples: Integer;
}

export interface WavDecodedAudio {
  /** Decoded audio per channel (non-interleaved). */
  channelData: Float32Array[];
  /** Number of samples decoded in this chunk. */
  samplesDecoded: Integer;
  /** Sample rate (Hz), typically 44,100 or 48,000. */
  sampleRate: CommonSampleRate | (number & {});
  /** Any decoding errors encountered in this chunk. */
  errors: DecodeError[];
}

export interface WaveFormat {
  /** Format code, e.g. PCM = 1, Float = 3, Extensible = 65534. */
  formatTag: WaveFormatTag | (number & {});
  /** Number of audio channels (1 = mono, 2 = stereo, etc.). */
  channels: Integer;
  /** Sample rate in Hz. */
  sampleRate: CommonSampleRate | (number & {});
  /** Average bytes per second, used for streaming/playback. */
  bytesPerSecond: Integer;
  /** Size of one frame = channels × bitsPerSample ÷ 8. */
  blockAlign: Integer;
  /** Bits per sample per channel. */
  bitsPerSample: WaveBitsPerSample | (number & {});
  /** Extension size (usually 22 if present). */
  extensionSize?: Integer;
  /** Valid bits per sample (for non-integer formats). */
  validBitsPerSample?: Integer;
  /** Channel mask for speaker layout (e.g., front left, rear right). */
  channelMask?: Integer;
  /** Sub-format identifier (usually a 16-byte GUID). */
  subFormat?: Uint8Array;
}
