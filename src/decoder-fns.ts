import { SCALE_16, SCALE_24, SCALE_32, SCALE_8 } from './constants';

/**
 * Represents a function that decodes audio data from a DataView into samples.
 * @param view The DataView containing the raw audio data.
 * @param samples The number of samples to decode.
 */
export type DecoderFn = (view: DataView, samples: number) => void;

/**
 * A lookup table to find the appropriate decoder function based on
 * audio format, number of channels, and bit depth.
 */
export interface DecoderLookup {
  [formatTag: number]: {
    [channels: number]: {
      [bitDepth: number]: DecoderFn | undefined;
    };
  };
}

/**
 * Processes a mono (single channel) audio buffer, converting it to Float32Array.
 * The loop is unrolled for performance.
 * @template T - The type of the input array-like object (e.g., Uint8Array, Int16Array).
 * @param {T} input The input audio data.
 * @param {Float32Array} out The output Float32Array to store the processed samples.
 * @param {number} frames The number of audio frames (samples) to process.
 * @param {number} scale The scaling factor to normalize the samples to the [-1.0, 1.0] range.
 * @param {(val: number) => number} [transform=(v) => v] An optional function to apply to each sample before scaling.
 */
function processMonoUnrolled<T extends ArrayLike<number>>(
  input: T,
  out: Float32Array,
  frames: number,
  scale: number,
  transform: (val: number) => number = (v) => v
): void {
  let i = 0;
  // Process 4 samples at a time for performance
  for (; i + 4 <= frames; i += 4) {
    out[i] = transform(input[i]!) * scale;
    out[i + 1] = transform(input[i + 1]!) * scale;
    out[i + 2] = transform(input[i + 2]!) * scale;
    out[i + 3] = transform(input[i + 3]!) * scale;
  }
  // Process remaining samples
  for (; i < frames; ++i) out[i] = transform(input[i]!) * scale;
}

/**
 * Processes a stereo (two-channel) interleaved audio buffer, de-interleaving and converting it into two Float32Arrays.
 * The loop is unrolled for performance.
 * @template T - The type of the input array-like object (e.g., Uint8Array, Int16Array).
 * @param {T} input The interleaved stereo audio data.
 * @param {Float32Array} left The output Float32Array for the left channel.
 * @param {Float32Array} right The output Float32Array for the right channel.
 * @param {number} frames The number of audio frames to process (for one channel).
 * @param {number} scale The scaling factor to normalize the samples to the [-1.0, 1.0] range.
 * @param {(val: number) => number} [transform=(v) => v] An optional function to apply to each sample before scaling.
 */
function processStereoUnrolled<T extends ArrayLike<number>>(
  input: T,
  left: Float32Array,
  right: Float32Array,
  frames: number,
  scale: number,
  transform: (val: number) => number = (v) => v
): void {
  let i = 0, // frame index
    j = 0; // input array index
  // Process 4 frames (8 samples) at a time for performance
  for (; i + 4 <= frames; i += 4, j += 8) {
    left[i] = transform(input[j]!) * scale;
    right[i] = transform(input[j + 1]!) * scale;
    left[i + 1] = transform(input[j + 2]!) * scale;
    right[i + 1] = transform(input[j + 3]!) * scale;
    left[i + 2] = transform(input[j + 4]!) * scale;
    right[i + 2] = transform(input[j + 5]!) * scale;
    left[i + 3] = transform(input[j + 6]!) * scale;
    right[i + 3] = transform(input[j + 7]!) * scale;
  }
  // Process remaining frames
  for (; i < frames; ++i, j += 2) {
    left[i] = transform(input[j]!) * scale;
    right[i] = transform(input[j + 1]!) * scale;
  }
}

/**
 * Extracts a 24-bit little-endian signed integer from a Uint8Array.
 * @param {Uint8Array} input The byte array containing the sample.
 * @param {number} offset The starting offset of the 3-byte sample.
 * @returns {number} The extracted 24-bit sample as a signed number.
 */
function extract24BitSample(input: Uint8Array, offset: number): number {
  // Combine the three bytes into a 24-bit integer (little-endian)
  let v = (input[offset + 2]! << 16) | (input[offset + 1]! << 8) | input[offset]!;
  // Extend the sign bit from 24 to 32 bits
  return (v << 8) >> 8;
}

/**
 * Decodes 8-bit unsigned PCM mono audio data into a Float32Array.
 * @param {Uint8Array} input The raw 8-bit mono audio data.
 * @param {Float32Array} out The output array for the decoded samples.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM8MonoUnrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  // Unsigned 8-bit PCM is in the range [0, 255]. We shift it to [-128, 127].
  processMonoUnrolled(input, out, frames, SCALE_8, (v) => v - 128);
}

/**
 * Decodes 8-bit unsigned PCM stereo audio data into two Float32Arrays.
 * @param {Uint8Array} input The raw 8-bit interleaved stereo audio data.
 * @param {Float32Array} left The output array for the left channel.
 * @param {Float32Array} right The output array for the right channel.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM8StereoUnrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  // Unsigned 8-bit PCM is in the range [0, 255]. We shift it to [-128, 127].
  processStereoUnrolled(input, left, right, frames, SCALE_8, (v) => v - 128);
}

/**
 * Decodes 16-bit signed PCM mono audio data into a Float32Array.
 * @param {Int16Array} input The raw 16-bit mono audio data.
 * @param {Float32Array} out The output array for the decoded samples.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM16MonoUnrolled(input: Int16Array, out: Float32Array, frames: number): void {
  processMonoUnrolled(input, out, frames, SCALE_16);
}

/**
 * Decodes 16-bit signed PCM stereo audio data into two Float32Arrays.
 * @param {Int16Array} input The raw 16-bit interleaved stereo audio data.
 * @param {Float32Array} left The output array for the left channel.
 * @param {Float32Array} right The output array for the right channel.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM16StereoUnrolled(input: Int16Array, left: Float32Array, right: Float32Array, frames: number): void {
  processStereoUnrolled(input, left, right, frames, SCALE_16);
}

/**
 * Decodes 24-bit signed PCM mono audio data into a Float32Array.
 * @param {Uint8Array} input The raw 24-bit mono audio data (as bytes).
 * @param {Float32Array} out The output array for the decoded samples.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM24MonoUnrolled(input: Uint8Array, out: Float32Array, frames: number): void {
  let i = 0,
    ofs = 0;
  // Process 4 frames at a time
  for (; i + 4 <= frames; i += 4, ofs += 12) {
    for (let u = 0; u < 4; ++u) {
      out[i + u] = extract24BitSample(input, ofs + u * 3) * SCALE_24;
    }
  }
  // Process remaining frames
  for (; i < frames; ++i, ofs += 3) {
    out[i] = extract24BitSample(input, ofs) * SCALE_24;
  }
}

/**
 * Decodes 24-bit signed PCM stereo audio data into two Float32Arrays.
 * @param {Uint8Array} input The raw 24-bit interleaved stereo audio data (as bytes).
 * @param {Float32Array} left The output array for the left channel.
 * @param {Float32Array} right The output array for the right channel.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM24StereoUnrolled(input: Uint8Array, left: Float32Array, right: Float32Array, frames: number): void {
  let i = 0,
    ofs = 0;
  // Process 4 frames (8 samples) at a time
  for (; i + 4 <= frames; i += 4, ofs += 24) {
    for (let u = 0; u < 4; ++u) {
      const o = ofs + u * 6; // base offset for the frame
      left[i + u] = extract24BitSample(input, o) * SCALE_24;
      right[i + u] = extract24BitSample(input, o + 3) * SCALE_24;
    }
  }
  // Process remaining frames
  for (; i < frames; ++i, ofs += 6) {
    left[i] = extract24BitSample(input, ofs) * SCALE_24;
    right[i] = extract24BitSample(input, ofs + 3) * SCALE_24;
  }
}

/**
 * Decodes 32-bit signed PCM mono audio data into a Float32Array.
 * @param {Int32Array} input The raw 32-bit mono audio data.
 * @param {Float32Array} out The output array for the decoded samples.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM32MonoUnrolled(input: Int32Array, out: Float32Array, frames: number): void {
  processMonoUnrolled(input, out, frames, SCALE_32);
}

/**
 * Decodes 32-bit signed PCM stereo audio data into two Float32Arrays.
 * @param {Int32Array} input The raw 32-bit interleaved stereo audio data.
 * @param {Float32Array} left The output array for the left channel.
 * @param {Float32Array} right The output array for the right channel.
 * @param {number} frames The number of frames to decode.
 */
function decodePCM32StereoUnrolled(input: Int32Array, left: Float32Array, right: Float32Array, frames: number): void {
  processStereoUnrolled(input, left, right, frames, SCALE_32);
}

/**
 * "Decodes" (copies) 32-bit float mono audio data into a Float32Array.
 * No scaling is needed as the source is already float.
 * @param {Float32Array} input The raw 32-bit float mono audio data.
 * @param {Float32Array} out The output array for the decoded samples.
 * @param {number} frames The number of frames to decode.
 */
function decodeFloat32MonoUnrolled(input: Float32Array, out: Float32Array, frames: number): void {
  processMonoUnrolled(input, out, frames, 1);
}

/**
 * "Decodes" (copies) 32-bit float stereo audio data into two Float32Arrays.
 * No scaling is needed as the source is already float.
 * @param {Float32Array} input The raw 32-bit float interleaved stereo audio data.
 * @param {Float32Array} left The output array for the left channel.
 * @param {Float32Array} right The output array for the right channel.
 * @param {number} frames The number of frames to decode.
 */
function decodeFloat32StereoUnrolled(
  input: Float32Array,
  left: Float32Array,
  right: Float32Array,
  frames: number
): void {
  processStereoUnrolled(input, left, right, frames, 1);
}

export {
  decodePCM8MonoUnrolled,
  decodePCM8StereoUnrolled,
  decodePCM16MonoUnrolled,
  decodePCM16StereoUnrolled,
  decodePCM24MonoUnrolled,
  decodePCM24StereoUnrolled,
  decodePCM32MonoUnrolled,
  decodePCM32StereoUnrolled,
  decodeFloat32MonoUnrolled,
  decodeFloat32StereoUnrolled,
};
