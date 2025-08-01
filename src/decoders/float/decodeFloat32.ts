export function decodeFloat32Mono(input: Float32Array, out: Float32Array, frames: number): void {
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i];
    out[i + 1] = input[i + 1];
    out[i + 2] = input[i + 2];
    out[i + 3] = input[i + 3];
  }
  for (; i < frames; ++i) out[i] = input[i];
}

export function decodeFloat32Stereo(
  input: Float32Array,
  left: Float32Array,
  right: Float32Array,
  frames: number
): void {
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j];
    right[i] = input[j + 1];
    left[i + 1] = input[j + 2];
    right[i + 1] = input[j + 3];
    left[i + 2] = input[j + 4];
    right[i + 2] = input[j + 5];
    left[i + 3] = input[j + 6];
    right[i + 3] = input[j + 7];
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j];
    right[i] = input[j + 1];
  }
}
