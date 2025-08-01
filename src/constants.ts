export const INV_128 = 1 / 128;

export const INV_32768 = 1 / 32768;
export const INV_8388608 = 1 / 8388608;
export const INV_2147483648 = 1 / 2147483648;

export const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
export const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
export const WAVE_FORMAT_MULAW = 0x0007;
export const WAVE_FORMAT_PCM = 0x0001;
export const WAVE_FORMAT_IMA_ADPCM = 0x0011;
export const WAVE_FORMAT_ALAW = 0x0006;

export const RIFF_SIGNATURE = 0x46464952 as const;
export const RIFX_SIGNATURE = 0x52494658 as const;
export const WAVE_SIGNATURE = 'WAVE' as const;
export const FMT_CHUNK = 'fmt ' as const;
export const DATA_CHUNK = 'data' as const;

export const IMA_STEP_TABLE = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

export const IMA_INDEX_ADJUST_TABLE = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

export const ALAW_TABLE = (() => {
  const table = new Float32Array(256);
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
    table[i] = sign * sample * INV_32768;
  }
  return table;
})();

export const MULAW_TABLE = (() => {
  const MULAW_BIAS = 0x84;
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let muVal = ~i & 0xff;
    let sign = muVal & 0x80 ? -1 : 1;
    let exponent = (muVal & 0x70) >> 4;
    let mantissa = muVal & 0x0f;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    table[i] = sign * sample * INV_32768;
  }
  return table;
})();

export const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Uint8Array([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

export const KSDATAFORMAT_SUBTYPE_PCM = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);
