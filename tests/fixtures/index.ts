export interface FixtureProperties {
  channels: number;
  sampleRate: number;
  bitDepth: number;
  samplesPerChannel: number;
  formatTag: number;
}

export const fixtureProperties: Record<string, FixtureProperties> = {
  'exotic_alt_clipped_silent_stereo.wav': {
    channels: 2,       // "stereo" in name
    sampleRate: 44100,
    bitDepth: 16,      // assumed common depth for clipped files
    samplesPerChannel: 44100,
    formatTag: 0x0001  // assumed PCM
  },
  'sine_pcm_8bit_le_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 8,       // "8bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // "pcm"
  },
  'exotic_float32_nan_inf.wav': {
    channels: 1,       // assumed mono (no channel specifier)
    sampleRate: 44100,
    bitDepth: 32,      // "float32"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sine_ulaw_8bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 8,       // "8bit"
    samplesPerChannel: 44100,
    formatTag: 0x0007  // ulaw
  },
  'sweep_pcm_24bit_le_8ch.wav': {
    channels: 8,       // "8ch"
    sampleRate: 44100,
    bitDepth: 24,      // "24bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_alaw_8bit_le_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 8,       // "8bit"
    samplesPerChannel: 44100,
    formatTag: 0x0006  // alaw
  },
  'sweep_float_32bit_le_8ch.wav': {
    channels: 8,       // "8ch"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sine_float_32bit_le_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'exotic_short_pcm16_80samples.wav': {
    channels: 1,       // implied by "pcm16" pattern
    sampleRate: 44100,
    bitDepth: 16,      // "pcm16"
    samplesPerChannel: 80, // "80samples"
    formatTag: 0x0001  // pcm
  },
  'sine_pcm_32bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_float_64bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 64,      // "64bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sweep_float_32bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sweep_pcm_16bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 16,      // "16bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_float_32bit_be_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sine_pcm_24bit_le_8ch.wav': {
    channels: 8,       // "8ch"
    sampleRate: 44100,
    bitDepth: 24,      // "24bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_float_32bit_le_8ch.wav': {
    channels: 8,       // "8ch"
    sampleRate: 44100,
    bitDepth: 32,      // "32bit"
    samplesPerChannel: 44100,
    formatTag: 0x0003  // float
  },
  'sine_pcm_16bit_le_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 16,      // "16bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_pcm_16bit_be_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 16,      // "16bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'exotic_silent_pcm16_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 16,      // "pcm16"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_pcm_24bit_be_stereo.wav': {
    channels: 2,       // "stereo"
    sampleRate: 44100,
    bitDepth: 24,      // "24bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'exotic_clipped_pcm16_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 16,      // "pcm16"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  },
  'sine_pcm_24bit_le_mono.wav': {
    channels: 1,       // "mono"
    sampleRate: 44100,
    bitDepth: 24,      // "24bit"
    samplesPerChannel: 44100,
    formatTag: 0x0001  // pcm
  }
};
