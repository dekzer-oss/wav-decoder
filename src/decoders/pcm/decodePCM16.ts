import { INV_32768 } from '../../constants.ts';

export function decodePCM16Mono(input: Int16Array, out: Float32Array, frames: number): void {
  const k = INV_32768;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i] * k;
    out[i + 1] = input[i + 1] * k;
    out[i + 2] = input[i + 2] * k;
    out[i + 3] = input[i + 3] * k;
  }
  for (; i < frames; ++i) out[i] = input[i] * k;
}

export function decodePCM16Stereo(input: Int16Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = INV_32768;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j] * k;
    right[i] = input[j + 1] * k;
    left[i + 1] = input[j + 2] * k;
    right[i + 1] = input[j + 3] * k;
    left[i + 2] = input[j + 4] * k;
    right[i + 2] = input[j + 5] * k;
    left[i + 3] = input[j + 6] * k;
    right[i + 3] = input[j + 7] * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j] * k;
    right[i] = input[j + 1] * k;
  }
}
