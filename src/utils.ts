/**
 * @fileoverview A collection of highly optimized audio decoding functions.
 * This module provides functions to decode various raw audio formats (PCM,
 * floating-point, A-law, μ-law) into 32-bit floating-point samples, normalized
 * to the range `$[-1.0, 1.0]$`. Functions are specialized for mono, stereo, and
 * multichannel (N-channel) layouts to maximize performance.
 */

// --- Pre-computed Constants ---

/** Scaling constant for 8-bit PCM. Converts `$[-128, 127]$` to `$[-1.0, 1.0]$`. */
const SCALE_8 = 1 / 128;
/** Scaling constant for 16-bit PCM. Converts `$[-32768, 32767]$` to `$[-1.0, 1.0]$`. */
const SCALE_16 = 1 / 32768;
/** Scaling constant for 24-bit PCM. Converts `$[-8388608, 8388607]$` to `$[-1.0, 1.0]$`. */
const SCALE_24 = 1 / 8388608;
/** Scaling constant for 32-bit PCM. Converts `$[-2147483648, 2147483647]$` to `$[-1.0, 1.0]$`. */
const SCALE_32 = 1 / 2147483648;

/** Offset for converting unsigned 8-bit PCM to signed. */
const PCM8_OFFSET = 128;

// --- Lookup Tables ---

/**
 * Pre-computed lookup table for fast A-law to 32-bit float conversion.
 * @type {Float32Array}
 */
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

/**
 * Pre-computed lookup table for fast μ-law to 32-bit float conversion.
 * @type {Float32Array}
 */
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

// --- 8-bit PCM Decoders ---

/**
 * Decodes 8-bit unsigned PCM mono audio data into a 32-bit float array.
 * @param {Uint8Array} bytes - The input buffer of 8-bit samples.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @returns {void}
 */
function decodePCM8Mono(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

  // Unroll loop for better performance on large buffers.
  const unrollEnd = len - (len % 4);
  for (; i < unrollEnd; i += 4) {
    out[i] = (bytes[i] - PCM8_OFFSET) * SCALE_8;
    out[i + 1] = (bytes[i + 1] - PCM8_OFFSET) * SCALE_8;
    out[i + 2] = (bytes[i + 2] - PCM8_OFFSET) * SCALE_8;
    out[i + 3] = (bytes[i + 3] - PCM8_OFFSET) * SCALE_8;
  }

  // Handle remaining samples.
  for (; i < len; i++) {
    out[i] = (bytes[i] - PCM8_OFFSET) * SCALE_8;
  }
}

/**
 * Decodes 8-bit unsigned PCM stereo audio data into two 32-bit float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved 8-bit samples.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @returns {void}
 */
function decodePCM8Stereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;
  let i = 0;

  // Unroll for stereo pairs.
  const unrollEnd = len - (len % 2);
  for (; i < unrollEnd; i += 2, offset += 4) {
    left[i] = (bytes[offset] - PCM8_OFFSET) * SCALE_8;
    right[i] = (bytes[offset + 1] - PCM8_OFFSET) * SCALE_8;
    left[i + 1] = (bytes[offset + 2] - PCM8_OFFSET) * SCALE_8;
    right[i + 1] = (bytes[offset + 3] - PCM8_OFFSET) * SCALE_8;
  }

  // Handle remaining samples.
  for (; i < len; i++, offset += 2) {
    left[i] = (bytes[offset] - PCM8_OFFSET) * SCALE_8;
    right[i] = (bytes[offset + 1] - PCM8_OFFSET) * SCALE_8;
  }
}

/**
 * Decodes N-channel 8-bit unsigned PCM audio into an array of float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved 8-bit samples.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @returns {void}
 */
function decodePCM8N(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      outs[ch][i] = (bytes[offset++] - PCM8_OFFSET) * SCALE_8;
    }
  }
}

// --- 16-bit PCM Decoders ---

/**
 * Decodes 16-bit signed PCM mono audio data into a 32-bit float array.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodePCM16Mono(view: DataView, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

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

/**
 * Decodes 16-bit signed PCM stereo audio data into two 32-bit float arrays.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes N-channel 16-bit signed PCM audio into an array of float arrays.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodePCM16N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 2) {
        outs[ch][i] = view.getInt16(offset, true) * SCALE_16;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 2) {
        outs[ch][i] = view.getInt16(offset, false) * SCALE_16;
      }
    }
  }
}

// --- 24-bit PCM Decoders ---

/**
 * Decodes 24-bit signed PCM mono audio data into a 32-bit float array.
 * @param {Uint8Array} bytes - The input buffer of 24-bit samples.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodePCM24Mono(bytes: Uint8Array, out: Float32Array, isLE: boolean): void {
  const len = out.length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < len; i++, offset += 3) {
      let v = (bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset];
      v = (v << 8) >> 8;
      out[i] = v * SCALE_24;
    }
  } else {
    for (let i = 0; i < len; i++, offset += 3) {
      let v = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
      v = (v << 8) >> 8;
      out[i] = v * SCALE_24;
    }
  }
}

/**
 * Decodes 24-bit signed PCM stereo audio data into two 32-bit float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved 24-bit samples.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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
      let vL = (bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset];
      vL = (vL << 8) >> 8;
      offset += 3;
      let vR = (bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset];
      vR = (vR << 8) >> 8;
      offset += 3;
      left[i] = vL * SCALE_24;
      right[i] = vR * SCALE_24;
    }
  } else {
    for (let i = 0; i < len; i++) {
      let vL = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
      vL = (vL << 8) >> 8;
      offset += 3;
      let vR = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
      vR = (vR << 8) >> 8;
      offset += 3;
      left[i] = vL * SCALE_24;
      right[i] = vR * SCALE_24;
    }
  }
}

/**
 * Decodes N-channel 24-bit signed PCM audio into an array of float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved 24-bit samples.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodePCM24N(bytes: Uint8Array, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 3) {
        let v = (bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset];
        v = (v << 8) >> 8;
        outs[ch][i] = v * SCALE_24;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 3) {
        let v = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
        v = (v << 8) >> 8;
        outs[ch][i] = v * SCALE_24;
      }
    }
  }
}

// --- 32-bit PCM Decoders ---

/**
 * Decodes 32-bit signed PCM mono audio data into a 32-bit float array.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes 32-bit signed PCM stereo audio data into two 32-bit float arrays.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes N-channel 32-bit signed PCM audio into an array of float arrays.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodePCM32N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        outs[ch][i] = view.getInt32(offset, true) * SCALE_32;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        outs[ch][i] = view.getInt32(offset, false) * SCALE_32;
      }
    }
  }
}

// --- 32-bit Float Decoders ---

/**
 * Decodes 32-bit float mono audio data, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes 32-bit float stereo audio, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes N-channel 32-bit float audio, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodeFloat32N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        const val = view.getFloat32(offset, true);
        outs[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 4) {
        const val = view.getFloat32(offset, false);
        outs[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  }
}

// --- 64-bit Float Decoders ---

/**
 * Decodes 64-bit float mono audio data, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes 64-bit float stereo audio, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
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

/**
 * Decodes N-channel 64-bit float audio, clamping values to `$[-1.0, 1.0]$`.
 * @param {DataView} view - The DataView over the input buffer.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @param {boolean} isLE - True for little-endian, false for big-endian.
 * @returns {void}
 */
function decodeFloat64N(view: DataView, outs: Float32Array[], isLE: boolean): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  if (isLE) {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 8) {
        const val = view.getFloat64(offset, true);
        outs[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  } else {
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++, offset += 8) {
        const val = view.getFloat64(offset, false);
        outs[ch][i] = val < -1 ? -1 : val > 1 ? 1 : val;
      }
    }
  }
}

// --- A-law Decoders ---

/**
 * Decodes A-law mono audio data into a 32-bit float array using a lookup table.
 * @param {Uint8Array} bytes - The input buffer of A-law samples.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @returns {void}
 */
function decodeAlaw(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

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

/**
 * Decodes A-law stereo audio data into two 32-bit float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved A-law samples.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @returns {void}
 */
function decodeAlawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;

  for (let i = 0; i < len; i++, offset += 2) {
    left[i] = ALAW_TABLE[bytes[offset]];
    right[i] = ALAW_TABLE[bytes[offset + 1]];
  }
}

/**
 * Decodes N-channel A-law audio into an array of float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved A-law samples.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @returns {void}
 */
function decodeAlawN(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      outs[ch][i] = ALAW_TABLE[bytes[offset++]];
    }
  }
}

// --- μ-law Decoders ---

/**
 * Decodes μ-law mono audio data into a 32-bit float array using a lookup table.
 * @param {Uint8Array} bytes - The input buffer of μ-law samples.
 * @param {Float32Array} out - The output array to store decoded samples.
 * @returns {void}
 */
function decodeMulaw(bytes: Uint8Array, out: Float32Array): void {
  const len = out.length;
  let i = 0;

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

/**
 * Decodes μ-law stereo audio data into two 32-bit float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved μ-law samples.
 * @param {Float32Array} left - The output array for the left channel.
 * @param {Float32Array} right - The output array for the right channel.
 * @returns {void}
 */
function decodeMulawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
  const len = left.length;
  let offset = 0;

  for (let i = 0; i < len; i++, offset += 2) {
    left[i] = MULAW_TABLE[bytes[offset]];
    right[i] = MULAW_TABLE[bytes[offset + 1]];
  }
}

/**
 * Decodes N-channel μ-law audio into an array of float arrays.
 * @param {Uint8Array} bytes - The input buffer of interleaved μ-law samples.
 * @param {Float32Array[]} outs - An array of output float arrays for each channel.
 * @returns {void}
 */
function decodeMulawN(bytes: Uint8Array, outs: Float32Array[]): void {
  const numChannels = outs.length;
  const samples = outs[0].length;
  let offset = 0;

  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      outs[ch][i] = MULAW_TABLE[bytes[offset++]];
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
