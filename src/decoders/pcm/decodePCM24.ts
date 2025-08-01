import { INV_8388608 } from '../../constants.ts';

export function decodePCM24Mono(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = INV_8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 12) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 3;
      let v = (input[o + 2] << 16) | (input[o + 1] << 8) | input[o];
      v = (v << 8) >> 8;
      out[i + u] = v * k;
    }
  }
  for (; i < frames; ++i, ofs += 3) {
    let v = (input[ofs + 2] << 16) | (input[ofs + 1] << 8) | input[ofs];
    v = (v << 8) >> 8;
    out[i] = v * k;
  }
}

export function decodePCM24Stereo(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = INV_8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 24) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 6;
      let lv = (input[o + 2] << 16) | (input[o + 1] << 8) | input[o];
      lv = (lv << 8) >> 8;
      left[i + u] = lv * k;
      let rv = (input[o + 5] << 16) | (input[o + 4] << 8) | input[o + 3];
      rv = (rv << 8) >> 8;
      right[i + u] = rv * k;
    }
  }
  for (; i < frames; ++i, ofs += 6) {
    let lv = (input[ofs + 2] << 16) | (input[ofs + 1] << 8) | input[ofs];
    lv = (lv << 8) >> 8;
    left[i] = lv * k;
    let rv = (input[ofs + 5] << 16) | (input[ofs + 4] << 8) | input[ofs + 3];
    rv = (rv << 8) >> 8;
    right[i] = rv * k;
  }
}
