// Pre-computed scaling constants - use multiplication instead of division
const SCALE_8 = 1 / 128;
const SCALE_16 = 1 / 32768;
const SCALE_24 = 1 / 8388608;
const SCALE_32 = 1 / 2147483648;

// Pre-computed constants
const PCM8_OFFSET = 128;

// Optimized lookup tables - single-pass generation
const ALAW_TABLE = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const aVal = i ^ 0x55;
    const sign = aVal & 0x80 ? -1 : 1;
    const exponent = (aVal & 0x70) >> 4;
    const mantissa = aVal & 0x0f;
    const sample =
      exponent === 0 ? (mantissa << 4) + 8 : ((mantissa + 16) << (exponent + 3)) - 2048;
    table[i] = sign * sample * SCALE_16;
  }
  return table;
})();

const MULAW_TABLE = (() => {
  const MULAW_BIAS = 0x84;
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const muVal = ~i & 0xff;
    const sign = muVal & 0x80 ? -1 : 1;
    const exponent = (muVal & 0x70) >> 4;
    const mantissa = muVal & 0x0f;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    table[i] = sign * sample * SCALE_16;
  }
  return table;
})();

// 8-bit PCM - highly optimized with loop unrolling for large buffers
function decodePCM8Mono(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

  // Unroll loop for better performance on large buffers
  const unrollEnd = len - (len % 4);
  for (; i < unrollEnd; i += 4) {
    out[i] = (bytes[i] - PCM8_OFFSET) * SCALE_8;
    out[i + 1] = (bytes[i + 1] - PCM8_OFFSET) * SCALE_8;
    out[i + 2] = (bytes[i + 2] - PCM8_OFFSET) * SCALE_8;
    out[i + 3] = (bytes[i + 3] - PCM8_OFFSET) * SCALE_8;
  }

  // Handle remaining samples
  for (; i < len; i++) {
    out[i] = (bytes[i] - PCM8_OFFSET) * SCALE_8;
  }
}

function decodePCM8Stereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;
  let i = 0;

  // Unroll for stereo pairs
  const unrollEnd = len - (len % 2);
  for (; i < unrollEnd; i += 2, offset += 4) {
    left[i] = (bytes[offset] - PCM8_OFFSET) * SCALE_8;
    right[i] = (bytes[offset + 1] - PCM8_OFFSET) * SCALE_8;
    left[i + 1] = (bytes[offset + 2] - PCM8_OFFSET) * SCALE_8;
    right[i + 1] = (bytes[offset + 3] - PCM8_OFFSET) * SCALE_8;
  }

  // Handle remaining samples
  for (; i < len; i++, offset += 2) {
    left[i] = (bytes[offset] - PCM8_OFFSET) * SCALE_8;
    right[i] = (bytes[offset + 1] - PCM8_OFFSET) * SCALE_8;
  }
}

function decodePCM8N(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  // Pre-cache channel arrays to avoid property lookups
  const channels = outs;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = (bytes[offset++] - PCM8_OFFSET) * SCALE_8;
    }
  }
}

// 16-bit PCM - optimized with minimal DataView overhead
function decodePCM16Mono(view: DataView, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  // Hoist endianness check outside loop
  if (isLE) {
    for (let i = 0; i < len; i++, offset += 2) {
      out[i] = view.getInt16(offset, true) * SCALE_16;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 2) {
      out[i] = view.getInt16(offset, false) * SCALE_16;
    }
  }
}

function decodePCM16Stereo(
  view: DataView,
  left: Float32Array,
  right: Float32Array,
  isLE: boolean,
): void {
  const len = left.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 4) {
      left[i] = view.getInt16(offset, true) * SCALE_16;
      right[i] = view.getInt16(offset + 2, true) * SCALE_16;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 4) {
      left[i] = view.getInt16(offset, false) * SCALE_16;
      right[i] = view.getInt16(offset + 2, false) * SCALE_16;
    }
  }
}

function decodePCM16N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 2) {
        channels[ch][i] = view.getInt16(offset, true) * SCALE_16;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 2) {
        channels[ch][i] = view.getInt16(offset, false) * SCALE_16;
      }
    }
  }
}

// 24-bit PCM - direct byte manipulation for maximum speed
function decodePCM24Mono(bytes: Uint8Array, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  // Hoist endianness and length checks out of hot loop
  if (isLE) {
    for (let i = 0; i < len; i++, offset += 3) {
      // Direct byte manipulation - faster than DataView for 24-bit
      const b0 = bytes[offset];
      const b1 = bytes[offset + 1];
      const b2 = bytes[offset + 2];
      let v = (b2 << 16) | (b1 << 8) | b0;
      v = (v << 8) >> 8; // Sign extend from 24 to 32 bits
      out[i] = v * SCALE_24;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 3) {
      const b0 = bytes[offset];
      const b1 = bytes[offset + 1];
      const b2 = bytes[offset + 2];
      let v = (b0 << 16) | (b1 << 8) | b2;
      v = (v << 8) >> 8;
      out[i] = v * SCALE_24;
    }
  }
}

function decodePCM24Stereo(
  bytes: Uint8Array,
  left: Float32Array,
  right: Float32Array,
  isLE: boolean,
): void {
  const len = left.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++) {
      // Left channel
      const lb0 = bytes[offset];
      const lb1 = bytes[offset + 1];
      const lb2 = bytes[offset + 2];
      let vL = (lb2 << 16) | (lb1 << 8) | lb0;
      vL = (vL << 8) >> 8;
      offset += 3;

      // Right channel
      const rb0 = bytes[offset];
      const rb1 = bytes[offset + 1];
      const rb2 = bytes[offset + 2];
      let vR = (rb2 << 16) | (rb1 << 8) | rb0;
      vR = (vR << 8) >> 8;
      offset += 3;

      left[i] = vL * SCALE_24;
      right[i] = vR * SCALE_24;
    }
  } else {
    for (let i = 0; i < len; i++) {
      // Left channel
      const lb0 = bytes[offset];
      const lb1 = bytes[offset + 1];
      const lb2 = bytes[offset + 2];
      let vL = (lb0 << 16) | (lb1 << 8) | lb2;
      vL = (vL << 8) >> 8;
      offset += 3;

      // Right channel
      const rb0 = bytes[offset];
      const rb1 = bytes[offset + 1];
      const rb2 = bytes[offset + 2];
      let vR = (rb0 << 16) | (rb1 << 8) | rb2;
      vR = (vR << 8) >> 8;
      offset += 3;

      left[i] = vL * SCALE_24;
      right[i] = vR * SCALE_24;
    }
  }
}

function decodePCM24N(bytes: Uint8Array, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 3) {
        const b0 = bytes[offset];
        const b1 = bytes[offset + 1];
        const b2 = bytes[offset + 2];
        let v = (b2 << 16) | (b1 << 8) | b0;
        v = (v << 8) >> 8;
        channels[ch][i] = v * SCALE_24;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 3) {
        const b0 = bytes[offset];
        const b1 = bytes[offset + 1];
        const b2 = bytes[offset + 2];
        let v = (b0 << 16) | (b1 << 8) | b2;
        v = (v << 8) >> 8;
        channels[ch][i] = v * SCALE_24;
      }
    }
  }
}

// 32-bit PCM - hoisted endianness checks
function decodePCM32Mono(view: DataView, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 4) {
      out[i] = view.getInt32(offset, true) * SCALE_32;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 4) {
      out[i] = view.getInt32(offset, false) * SCALE_32;
    }
  }
}

function decodePCM32Stereo(
  view: DataView,
  left: Float32Array,
  right: Float32Array,
  isLE: boolean,
): void {
  const len = left.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 8) {
      left[i] = view.getInt32(offset, true) * SCALE_32;
      right[i] = view.getInt32(offset + 4, true) * SCALE_32;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 8) {
      left[i] = view.getInt32(offset, false) * SCALE_32;
      right[i] = view.getInt32(offset + 4, false) * SCALE_32;
    }
  }
}

function decodePCM32N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        channels[ch][i] = view.getInt32(offset, true) * SCALE_32;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        channels[ch][i] = view.getInt32(offset, false) * SCALE_32;
      }
    }
  }
}

// Float32 - fastest possible clamping with hoisted endianness
function decodeFloat32Mono(view: DataView, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 4) {
      const val = view.getFloat32(offset, true);
      out[i] = val < -1 ? -1 : val > 1 ? 1 : val;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 4) {
      const val = view.getFloat32(offset, false);
      out[i] = val < -1 ? -1 : val > 1 ? 1 : val;
    }
  }
}

function decodeFloat32Stereo(
  view: DataView,
  left: Float32Array,
  right: Float32Array,
  isLE: boolean,
): void {
  const len = left.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 8) {
      const valL = view.getFloat32(offset, true);
      const valR = view.getFloat32(offset + 4, true);
      left[i] = valL < -1 ? -1 : valL > 1 ? 1 : valL;
      right[i] = valR < -1 ? -1 : valR > 1 ? 1 : valR;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 8) {
      const valL = view.getFloat32(offset, false);
      const valR = view.getFloat32(offset + 4, false);
      left[i] = valL < -1 ? -1 : valL > 1 ? 1 : valL;
      right[i] = valR < -1 ? -1 : valR > 1 ? 1 : valR;
    }
  }
}

function decodeFloat32N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        const val = view.getFloat32(offset, true);
        channels[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        const val = view.getFloat32(offset, false);
        channels[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  }
}

// Float64 - hoisted endianness with optimized clamping
function decodeFloat64Mono(view: DataView, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 8) {
      const val = view.getFloat64(offset, true);
      out[i] = val < -1 ? -1 : val > 1 ? 1 : val;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 8) {
      const val = view.getFloat64(offset, false);
      out[i] = val < -1 ? -1 : val > 1 ? 1 : val;
    }
  }
}

function decodeFloat64Stereo(
  view: DataView,
  left: Float32Array,
  right: Float32Array,
  isLE: boolean,
): void {
  const len = left.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 16) {
      const valL = view.getFloat64(offset, true);
      const valR = view.getFloat64(offset + 8, true);
      left[i] = valL < -1 ? -1 : valL > 1 ? 1 : valL;
      right[i] = valR < -1 ? -1 : valR > 1 ? 1 : valR;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 16) {
      const valL = view.getFloat64(offset, false);
      const valR = view.getFloat64(offset + 8, false);
      left[i] = valL < -1 ? -1 : valL > 1 ? 1 : valL;
      right[i] = valR < -1 ? -1 : valR > 1 ? 1 : valR;
    }
  }
}

function decodeFloat64N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 8) {
        const val = view.getFloat64(offset, true);
        channels[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 8) {
        const val = view.getFloat64(offset, false);
        channels[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  }
}

// A-law and μ-law - already optimal with lookup tables, no per-sample branching
function decodeAlaw(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

  // Unroll for large buffers
  const unrollEnd = len - (len % 4);
  for (; i < unrollEnd; i += 4) {
    out[i] = ALAW_TABLE[bytes[i]];
    out[i + 1] = ALAW_TABLE[bytes[i + 1]];
    out[i + 2] = ALAW_TABLE[bytes[i + 2]];
    out[i + 3] = ALAW_TABLE[bytes[i + 3]];
  }

  for (; i < len; i++) {
    out[i] = ALAW_TABLE[bytes[i]];
  }
}

function decodeAlawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;

  for (let i = 0; i < len; i++, offset += 2) {
    left[i] = ALAW_TABLE[bytes[offset]];
    right[i] = ALAW_TABLE[bytes[offset + 1]];
  }
}

function decodeAlawN(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = ALAW_TABLE[bytes[offset++]];
    }
  }
}

function decodeMulaw(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

  // Unroll for large buffers
  const unrollEnd = len - (len % 4);
  for (; i < unrollEnd; i += 4) {
    out[i] = MULAW_TABLE[bytes[i]];
    out[i + 1] = MULAW_TABLE[bytes[i + 1]];
    out[i + 2] = MULAW_TABLE[bytes[i + 2]];
    out[i + 3] = MULAW_TABLE[bytes[i + 3]];
  }

  for (; i < len; i++) {
    out[i] = MULAW_TABLE[bytes[i]];
  }
}

function decodeMulawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;

  for (let i = 0; i < len; i++, offset += 2) {
    left[i] = MULAW_TABLE[bytes[offset]];
    right[i] = MULAW_TABLE[bytes[offset + 1]];
  }
}

function decodeMulawN(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  const channels = outs;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = MULAW_TABLE[bytes[offset++]];
    }
  }
}

export {
  decodePCM8Mono,
  decodePCM8Stereo,
  decodePCM8N,
  decodePCM16Mono,
  decodePCM16Stereo,
  decodePCM16N,
  decodePCM24Mono,
  decodePCM24Stereo,
  decodePCM24N,
  decodePCM32Mono,
  decodePCM32Stereo,
  decodePCM32N,
  decodeFloat32Mono,
  decodeFloat32Stereo,
  decodeFloat32N,
  decodeFloat64Mono,
  decodeFloat64Stereo,
  decodeFloat64N,
  decodeAlaw,
  decodeAlawStereo,
  decodeAlawN,
  decodeMulaw,
  decodeMulawStereo,
  decodeMulawN,
};
