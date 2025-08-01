import { INV_128 } from '../../constants.ts';

export function decodePCM8Mono(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = INV_128;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = (input[i] - 128) * k;
    out[i + 1] = (input[i + 1] - 128) * k;
    out[i + 2] = (input[i + 2] - 128) * k;
    out[i + 3] = (input[i + 3] - 128) * k;
  }
  for (; i < frames; ++i) out[i] = (input[i] - 128) * k;
}

export function decodePCM8Stereo(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = INV_128;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = (input[j] - 128) * k;
    right[i] = (input[j + 1] - 128) * k;
    left[i + 1] = (input[j + 2] - 128) * k;
    right[i + 1] = (input[j + 3] - 128) * k;
    left[i + 2] = (input[j + 4] - 128) * k;
    right[i + 2] = (input[j + 5] - 128) * k;
    left[i + 3] = (input[j + 6] - 128) * k;
    right[i + 3] = (input[j + 7] - 128) * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = (input[j] - 128) * k;
    right[i] = (input[j + 1] - 128) * k;
  }
}
