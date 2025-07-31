/* ----------------------------------------------------------------------
 *  fixtures.ts
 *  Source-of-truth metadata for every bundled WAV fixture file.
 *  ------------------------------------------------------------------- */

export interface FixtureProperties {
  /** number of interleaved channels in the PCM data */
  channels: number;
  /** sampling frequency in Hz */
  sampleRate: number;
  /** nominal bit-depth of a single sample (4 / 8 / 16 / 24 / 32 / 64) */
  bitDepth: number;
  /** total samples **per** channel (not frames) in the file */
  samplesPerChannel: number;
  /** WAVE format-tag (see Microsoft’s Wave Format Codes)            */
  formatTag: number;
}

/**
 * Literal-typed map <filename → metadata>.
 * `satisfies` keeps the rich literal information **and** guarantees that every
 * entry is assignable to `FixtureProperties`.
 */
export const fixtureProperties = {
  'exotic_alt_clipped_silent_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_pcm_8bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 8,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'exotic_float32_nan_inf.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sine_ulaw_8bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 8,
    samplesPerChannel: 44_100,
    formatTag: 0x0007,
  },
  'sweep_pcm_24bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44_100,
    bitDepth: 24,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_alaw_8bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 8,
    samplesPerChannel: 44_100,
    formatTag: 0x0006,
  },
  'sweep_float_32bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sine_float_32bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'exotic_short_pcm16_80samples.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 80,
    formatTag: 0x0001,
  },
  'sine_pcm_32bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_float_64bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 64,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sweep_float_32bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sweep_pcm_16bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_float_32bit_be_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sine_pcm_24bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44_100,
    bitDepth: 24,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_float_32bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44_100,
    bitDepth: 32,
    samplesPerChannel: 44_100,
    formatTag: 0x0003,
  },
  'sine_pcm_16bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_pcm_16bit_be_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'exotic_silent_pcm16_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_pcm_24bit_be_stereo.wav': {
    channels: 2,
    sampleRate: 44_100,
    bitDepth: 24,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'exotic_clipped_pcm16_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 16,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
  'sine_pcm_24bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44_100,
    bitDepth: 24,
    samplesPerChannel: 44_100,
    formatTag: 0x0001,
  },
} as const satisfies Record<string, FixtureProperties>;

/** Literal union of all fixture filenames, e.g. `"sine_pcm_8bit_le_mono.wav"`. */
export type FixtureKey = keyof typeof fixtureProperties;

/** Strongly typed array of all fixture filenames. */
export const fixtureKeys: readonly FixtureKey[] = Object.keys(fixtureProperties) as FixtureKey[];
