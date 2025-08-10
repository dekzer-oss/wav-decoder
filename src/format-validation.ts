import {
  WAVE_FORMAT_ALAW,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_FORMAT_MULAW,
  WAVE_FORMAT_PCM,
} from './constants';

/**
 * A set of supported audio format tags.
 *
 * This set defines which audio compression formats the library can handle.
 * The values correspond to the `wFormatTag` field in a WAVE file's format chunk.
 *
 * @type {Set<number>}
 */
export const SUPPORTED_FORMATS: Set<number> = new Set([
  WAVE_FORMAT_PCM,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_ALAW,
  WAVE_FORMAT_MULAW,
  WAVE_FORMAT_IMA_ADPCM,
]);

/**
 * A map that specifies the valid bit depths for each supported audio format.
 *
 * This map provides a quick way to check if a specific bit depth is supported
 * for a given audio format tag. For example, `VALID_BIT_DEPTHS.get(WAVE_FORMAT_PCM)`
 * returns an array `[8, 16, 24, 32]`, indicating the valid bit depths for PCM data.
 *
 * @type {Map<number, number[]>}
 */
export const VALID_BIT_DEPTHS: Map<number, number[]> = new Map([
  [WAVE_FORMAT_PCM, [8, 16, 24, 32]],
  [WAVE_FORMAT_IEEE_FLOAT, [32, 64]],
  [WAVE_FORMAT_ALAW, [8]],
  [WAVE_FORMAT_MULAW, [8]],
  [WAVE_FORMAT_IMA_ADPCM, [4]],
]);

/**
 * The `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT` GUID as a `Uint8Array`.
 *
 * This GUID (Globally Unique Identifier) is used in the `WAVEFORMATEXTENSIBLE`
 * structure to specify that the audio data is in IEEE 754 floating-point format.
 * This is an extended format used for more advanced audio specifications.
 *
 * @type {Uint8Array}
 */
export const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: Uint8Array = new Uint8Array([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

/**
 * The `KSDATAFORMAT_SUBTYPE_PCM` GUID as a `Uint8Array`.
 *
 * This GUID is used in the `WAVEFORMATEXTENSIBLE` structure to specify that the
 * audio data is in standard pulse-code modulation (PCM) format.
 *
 * @type {Uint8Array}
 */
export const KSDATAFORMAT_SUBTYPE_PCM: Uint8Array = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);
