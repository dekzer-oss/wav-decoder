import { MULAW_TABLE } from '../../constants.ts';

export function decodeMuLawMono(input: Uint8Array, out: Float32Array, frames: number): void {
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = MULAW_TABLE[input[i]];
    out[i + 1] = MULAW_TABLE[input[i + 1]];
    out[i + 2] = MULAW_TABLE[input[i + 2]];
    out[i + 3] = MULAW_TABLE[input[i + 3]];
  }
  for (; i < frames; ++i) out[i] = MULAW_TABLE[input[i]];
}

export function decodeMuLawStereo(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = MULAW_TABLE[input[j]];
    right[i] = MULAW_TABLE[input[j + 1]];
    left[i + 1] = MULAW_TABLE[input[j + 2]];
    right[i + 1] = MULAW_TABLE[input[j + 3]];
    left[i + 2] = MULAW_TABLE[input[j + 4]];
    right[i + 2] = MULAW_TABLE[input[j + 5]];
    left[i + 3] = MULAW_TABLE[input[j + 6]];
    right[i + 3] = MULAW_TABLE[input[j + 7]];
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = MULAW_TABLE[input[j]];
    right[i] = MULAW_TABLE[input[j + 1]];
  }
}
