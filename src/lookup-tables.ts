import { SCALE_16 } from './constants';

let _alawTable: Float32Array | null = null;
let _mulawTable: Float32Array | null = null;

/**
 * Lazily generates and returns a lookup table for A-law decompression.
 *
 * This function creates a `Float32Array` of size 256, where each index
 * corresponds to an 8-bit A-law encoded value. The value at that index
 * is the 16-bit linear PCM equivalent, normalized to the [-1.0, 1.0] range.
 * The table is generated only on the first call and then cached for subsequent
 * access, improving performance.
 *
 * @returns {Float32Array} The cached or newly-generated A-law lookup table.
 */
export function getAlawTable(): Float32Array {
  if (!_alawTable) {
    _alawTable = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let aVal = i ^ 0x55;
      let sign = aVal & 0x80 ? -1 : 1;
      let exponent = (aVal & 0x70) >> 4;
      let mantissa = aVal & 0x0f;
      let sample: number;
      if (exponent === 0) {
        sample = (mantissa << 4) + 8;
      } else {
        sample = ((mantissa + 16) << (exponent + 3)) - 2048;
      }
      _alawTable[i] = sign * sample * SCALE_16;
    }
  }
  return _alawTable;
}

/**
 * Lazily generates and returns a lookup table for μ-law decompression.
 *
 * Similar to `getAlawTable`, this function creates a `Float32Array` mapping
 * 8-bit μ-law encoded values to 16-bit linear PCM equivalents, normalized
 * to the [-1.0, 1.0] range. The table is generated once and cached for
 * efficient retrieval.
 *
 * @returns {Float32Array} The cached or newly-generated μ-law lookup table.
 */
export function getMulawTable(): Float32Array {
  if (!_mulawTable) {
    const MULAW_BIAS = 0x84;
    _mulawTable = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let muVal = ~i & 0xff;
      let sign = muVal & 0x80 ? -1 : 1;
      let exponent = (muVal & 0x70) >> 4;
      let mantissa = muVal & 0x0f;
      let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
      sample -= MULAW_BIAS;
      _mulawTable[i] = sign * sample * SCALE_16;
    }
  }
  return _mulawTable;
}

// IMA ADPCM tables (small enough to initialize immediately)
/**
 * A static lookup table for IMA ADPCM step sizes.
 *
 * This table is a core component of the IMA ADPCM algorithm, used to
 * determine the quantization step size for decoding a sample. The index
 * into this table is adjusted based on the current sample's value,
 * dynamically changing the step size to adapt to the audio signal's
 * characteristics.
 *
 * @type {Int32Array}
 */
export const IMA_STEP_TABLE: Int32Array = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

/**
 * A static lookup table for adjusting the index of the `IMA_STEP_TABLE`.
 *
 * In IMA ADPCM, after decoding a sample, this table is used to calculate
 * the next index for the step size table. The 4-bit encoded value from the
 * input stream serves as an index into this table, which returns a value
 * to add to the current step index. This mechanism allows the algorithm
 * to adaptively change the step size for the next sample.
 *
 * @type {Int8Array}
 */
export const IMA_INDEX_ADJUST_TABLE: Int8Array = new Int8Array([
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
]);
