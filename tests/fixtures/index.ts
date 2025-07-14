export interface FixtureProperties {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  samplesPerChannel: number;
  formatTag: number;
}

export const fixtureProperties: Record<string, FixtureProperties> = {
  'exotic_alt_clipped_silent_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_pcm_8bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'exotic_float32_nan_inf.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sine_ulaw_8bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0007,
  },
  'sweep_pcm_24bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_alaw_8bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0006,
  },
  'sweep_float_32bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sine_float_32bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'exotic_short_pcm16_80samples.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 80,
    formatTag: 0x0001,
  },
  'sine_pcm_32bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_float_64bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 64,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sweep_float_32bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sweep_pcm_16bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_float_32bit_be_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sine_pcm_24bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_float_32bit_le_8ch.wav': {
    channels: 8,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'sine_pcm_16bit_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_pcm_16bit_be_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'exotic_silent_pcm16_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_pcm_24bit_be_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'exotic_clipped_pcm16_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'sine_pcm_24bit_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
};
