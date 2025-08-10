/**
 * The format tag for A-law encoded audio.
 * @type {0x0006}
 * @constant
 */
export const WAVE_FORMAT_ALAW: 0x0006 = 0x0006;

/**
 * The format tag for WAVEFORMATEXTENSIBLE, an extended format for complex audio types.
 * @type {0xfffe}
 * @constant
 */
export const WAVE_FORMAT_EXTENSIBLE: 0xfffe = 0xfffe;

/**
 * The format tag for IEEE 754 floating-point audio data.
 * @type {0x0003}
 * @constant
 */
export const WAVE_FORMAT_IEEE_FLOAT: 0x0003 = 0x0003;

/**
 * The format tag for μ-law encoded audio.
 * @type {0x0007}
 * @constant
 */
export const WAVE_FORMAT_MULAW: 0x0007 = 0x0007;

/**
 * The format tag for standard pulse-code modulation (PCM) audio.
 * @type {0x0001}
 * @constant
 */
export const WAVE_FORMAT_PCM: 0x0001 = 0x0001;

/**
 * The format tag for IMA Adaptive Differential Pulse-Code Modulation (ADPCM) audio.
 * @type {0x0011}
 * @constant
 */
export const WAVE_FORMAT_IMA_ADPCM: 0x0011 = 0x0011;

/**
 * The scaling factor to normalize 8-bit audio samples to the [-1.0, 1.0] range.
 * @type {number}
 * @constant
 */
export const SCALE_8: number = 1 / 128;

/**
 * The scaling factor to normalize 16-bit audio samples to the [-1.0, 1.0] range.
 * @type {number}
 * @constant
 */
export const SCALE_16: number = 1 / 32768;

/**
 * The scaling factor to normalize 24-bit audio samples to the [-1.0, 1.0] range.
 * @type {number}
 * @constant
 */
export const SCALE_24: number = 1 / 8388608;

/**
 * The scaling factor to normalize 32-bit audio samples to the [-1.0, 1.0] range.
 * @type {number}
 * @constant
 */
export const SCALE_32: number = 1 / 2147483648;

/**
 * The four-character code (FourCC) for a standard RIFF (Resource Interchange File Format) chunk.
 * @type {0x52494646}
 * @constant
 */
export const ID_RIFF: 0x52494646 = 0x52494646;

/**
 * The FourCC for a RIFFX chunk, a big-endian variant of RIFF.
 * @type {0x52494658}
 * @constant
 */
export const ID_RIFX: 0x52494658 = 0x52494658;

/**
 * The FourCC for a "WAVE" chunk, indicating that the RIFF file is a WAVE audio file.
 * @type {0x57415645}
 * @constant
 */
export const ID_WAVE: 0x57415645 = 0x57415645;

/**
 * The FourCC for a "fmt " chunk, which contains the format information of the audio data.
 * @type {0x666d7420}
 * @constant
 */
export const ID_FMT: 0x666d7420 = 0x666d7420;

/**
 * The FourCC for a "data" chunk, which contains the raw audio sample data.
 * @type {0x64617461}
 * @constant
 */
export const ID_DATA: 0x64617461 = 0x64617461;

/**
 * The FourCC for a "fact" chunk, which is required for compressed audio formats to store the number of samples.
 * @type {0x66616374}
 * @constant
 */
export const ID_FACT: 0x66616374 = 0x66616374;
