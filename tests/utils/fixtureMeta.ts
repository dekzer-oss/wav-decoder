export interface FixtureProperties {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  samplesPerChannel: number;
  formatTag: number;
}

export const fixtureProperties: Record<string, FixtureProperties> = {
  'pcm_d8_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'pcm_d16_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'pcm_d24_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'pcm_d32_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'pcm_d16_be_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 16,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'pcm_d24_be_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 24,
    samplesPerChannel: 44100,
    formatTag: 0x0001,
  },
  'float_d32_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'float_d64_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 64,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'float_d32_be_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 32,
    samplesPerChannel: 44100,
    formatTag: 0x0003,
  },
  'alaw_d8_le_mono.wav': {
    channels: 1,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0006,
  },
  'ulaw_d8_le_stereo.wav': {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 8,
    samplesPerChannel: 44100,
    formatTag: 0x0007,
  },
};
