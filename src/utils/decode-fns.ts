function decodePCM8Mono_unrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = 1 / 128;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = (input[i]! - 128) * k;
    out[i + 1] = (input[i + 1]! - 128) * k;
    out[i + 2] = (input[i + 2]! - 128) * k;
    out[i + 3] = (input[i + 3]! - 128) * k;
  }
  for (; i < frames; ++i) out[i] = (input[i]! - 128) * k;
}

function decodePCM8Stereo_unrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 128;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = (input[j]! - 128) * k;
    right[i] = (input[j + 1]! - 128) * k;
    left[i + 1] = (input[j + 2]! - 128) * k;
    right[i + 1] = (input[j + 3]! - 128) * k;
    left[i + 2] = (input[j + 4]! - 128) * k;
    right[i + 2] = (input[j + 5]! - 128) * k;
    left[i + 3] = (input[j + 6]! - 128) * k;
    right[i + 3] = (input[j + 7]! - 128) * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = (input[j]! - 128) * k;
    right[i] = (input[j + 1]! - 128) * k;
  }
}

function decodePCM16Mono_unrolled(input: Int16Array, out: Float32Array, frames: number): void {
  const k = 1 / 32768;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]! * k;
    out[i + 1] = input[i + 1]! * k;
    out[i + 2] = input[i + 2]! * k;
    out[i + 3] = input[i + 3]! * k;
  }
  for (; i < frames; ++i) out[i] = input[i]! * k;
}

function decodePCM16Stereo_unrolled(input: Int16Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 32768;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
    left[i + 1] = input[j + 2]! * k;
    right[i + 1] = input[j + 3]! * k;
    left[i + 2] = input[j + 4]! * k;
    right[i + 2] = input[j + 5]! * k;
    left[i + 3] = input[j + 6]! * k;
    right[i + 3] = input[j + 7]! * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
  }
}

function decodePCM24Mono_unrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  const k = 1 / 8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 12) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 3;
      let v = (input[o + 2]! << 16) | (input[o + 1]! << 8) | input[o]!;
      v = (v << 8) >> 8;
      out[i + u] = v * k;
    }
  }
  for (; i < frames; ++i, ofs += 3) {
    let v = (input[ofs + 2]! << 16) | (input[ofs + 1]! << 8) | input[ofs]!;
    v = (v << 8) >> 8;
    out[i] = v * k;
  }
}

function decodePCM24Stereo_unrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 8388608;
  let i = 0,
    ofs = 0;
  for (; i + 4 <= frames; i += 4, ofs += 24) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 6;
      let lv = (input[o + 2]! << 16) | (input[o + 1]! << 8) | input[o]!;
      lv = (lv << 8) >> 8;
      left[i + u] = lv * k;
      let rv = (input[o + 5]! << 16) | (input[o + 4]! << 8) | input[o + 3]!;
      rv = (rv << 8) >> 8;
      right[i + u] = rv * k;
    }
  }
  for (; i < frames; ++i, ofs += 6) {
    let lv = (input[ofs + 2]! << 16) | (input[ofs + 1]! << 8) | input[ofs]!;
    lv = (lv << 8) >> 8;
    left[i] = lv * k;
    let rv = (input[ofs + 5]! << 16) | (input[ofs + 4]! << 8) | input[ofs + 3]!;
    rv = (rv << 8) >> 8;
    right[i] = rv * k;
  }
}

function decodePCM32Mono_unrolled(input: Int32Array, out: Float32Array, frames: number): void {
  const k = 1 / 2147483648;
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]! * k;
    out[i + 1] = input[i + 1]! * k;
    out[i + 2] = input[i + 2]! * k;
    out[i + 3] = input[i + 3]! * k;
  }
  for (; i < frames; ++i) out[i] = input[i]! * k;
}

function decodePCM32Stereo_unrolled(input: Int32Array, left: Float32Array, right: Float32Array, frames: number): void {
  const k = 1 / 2147483648;
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
    left[i + 1] = input[j + 2]! * k;
    right[i + 1] = input[j + 3]! * k;
    left[i + 2] = input[j + 4]! * k;
    right[i + 2] = input[j + 5]! * k;
    left[i + 3] = input[j + 6]! * k;
    right[i + 3] = input[j + 7]! * k;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]! * k;
    right[i] = input[j + 1]! * k;
  }
}

function decodeFloat32Mono_unrolled(input: Float32Array, out: Float32Array, frames: number): void {
  let i = 0;
  for (; i + 4 <= frames; i += 4) {
    out[i] = input[i]!;
    out[i + 1] = input[i + 1]!;
    out[i + 2] = input[i + 2]!;
    out[i + 3] = input[i + 3]!;
  }
  for (; i < frames; ++i) out[i] = input[i]!;
}

function decodeFloat32Stereo_unrolled(
  input: Float32Array,
  left: Float32Array,
  right: Float32Array,
  frames: number
): void {
  let i = 0,
    j = 0;
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = input[j]!;
    right[i] = input[j + 1]!;
    left[i + 1] = input[j + 2]!;
    right[i + 1] = input[j + 3]!;
    left[i + 2] = input[j + 4]!;
    right[i + 2] = input[j + 5]!;
    left[i + 3] = input[j + 6]!;
    right[i + 3] = input[j + 7]!;
  }
  for (; i < frames; ++i, j += 2) {
    left[i] = input[j]!;
    right[i] = input[j + 1]!;
  }
}

export {
  decodePCM8Mono_unrolled,
  decodePCM8Stereo_unrolled,
  decodePCM16Mono_unrolled,
  decodePCM16Stereo_unrolled,
  decodePCM24Mono_unrolled,
  decodePCM24Stereo_unrolled,
  decodePCM32Mono_unrolled,
  decodePCM32Stereo_unrolled,
  decodeFloat32Mono_unrolled,
  decodeFloat32Stereo_unrolled,
};
