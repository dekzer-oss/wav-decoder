/**
 * Audio format tag values used in WAV files.
 * - 1 = PCM
 * - 3 = IEEE Float
 * - 6 = A-law
 * - 7 = µ-law
 * - 65534 = Extensible (used for non-standard formats)
 */
export type WaveFormatTag = 1 | 3 | 6 | 7 | 65534;

/**
 * Common bit depths used in WAV files.
 */
export type WaveBitsPerSample = 8 | 16 | 24 | 32 | 64;

/**
 * Standard audio sample rates in Hz.
 */
export type CommonSampleRate = 8000 | 16000 | 22050 | 44100 | 48000 | 96000 | 192000;

/**
 * Information about a decoding error encountered while processing a WAV file.
 */
export interface DecodeError {
  message: string;
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  outputSamples: number;
}


export interface DecodedWaveAudio {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: CommonSampleRate | (number & {});
  errors: DecodeError[];
}

export interface InterleavedDecodeResult {
  samplesDecoded: number;
  errors: DecodeError[];
}

export interface WaveFormat {
  format: WaveFormatTag | (number & {});
  numChannels: number;
  sampleRate: CommonSampleRate | (number & {});
  byteRate: number;
  blockAlign: number;
  bitsPerSample: WaveBitsPerSample | (number & {});
  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subFormat?: Uint8Array;
}
