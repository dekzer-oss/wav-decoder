/**
 * High-performance PCM decoder for WAV/AIFF/raw interleaved audio.
 * - Fastest possible dispatch for mono/stereo.
 * - N-channel flexible routines for rare >2ch formats.
 * - A-law/µ-law, 8/16/24/32 PCM, 32/64 float, mono/stereo/N.
 * - Strict TS, all arrays are expected sized/correct.
 * @class
 */
export class PCMDecoder {
  /**
   * Scaling factor for 8-bit PCM samples.
   * @readonly
   */
  static readonly SCALE_8 = 1 / 128;
  /**
   * Scaling factor for 16-bit PCM samples.
   * @readonly
   */
  static readonly SCALE_16 = 1 / 32768;
  /**
   * Scaling factor for 24-bit PCM samples.
   * @readonly
   */
  static readonly SCALE_24 = 1 / 8388608;
  /**
   * Scaling factor for 32-bit PCM samples.
   * @readonly
   */
  static readonly SCALE_32 = 1 / 2147483648;

  /**
   * Pre-calculated lookup table for A-law decoding.
   * @readonly
   */
  static readonly ALAW_TABLE = (() => {
    const table = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let aVal = i ^ 0x55;
      let sign = aVal & 0x80 ? -1 : 1;
      let exponent = (aVal & 0x70) >> 4;
      let mantissa = aVal & 0x0f;
      let sample =
        exponent === 0 ? (mantissa << 4) + 8 : ((mantissa + 16) << (exponent + 3)) - 2048;
      table[i] = (sign * sample) / 32768;
    }
    return table;
  })();

  /**
   * Pre-calculated lookup table for µ-law decoding.
   * @readonly
   */
  static readonly MULAW_TABLE = (() => {
    const MULAW_BIAS = 0x84;
    const table = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let muVal = ~i & 0xff;
      let sign = muVal & 0x80 ? -1 : 1;
      let exponent = (muVal & 0x70) >> 4;
      let mantissa = muVal & 0x0f;
      let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
      sample -= MULAW_BIAS;
      table[i] = (sign * sample) / 32768;
    }
    return table;
  })();

  /**
   * Creates an instance of PCMDecoder.
   * @param {boolean} isLittleEndian - Specifies the endianness of the audio data.
   */
  constructor(public readonly isLittleEndian: boolean) {}

  /**
   * Decodes 8-bit PCM mono audio.
   * @param {Uint8Array} bytes - The raw byte buffer to decode.
   * @param {Float32Array} out - The output array to write the decoded samples to.
   */
  public decodePCM8Mono(bytes: Uint8Array, out: Float32Array): void {
    for (let i = 0; i < out.length; i++) {
      out[i] = (bytes[i]! - 128) * PCMDecoder.SCALE_8;
    }
  }

  /**
   * Decodes 8-bit PCM stereo audio.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer to decode.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodePCM8Stereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++) {
      left[i] = (bytes[o++]! - 128) * PCMDecoder.SCALE_8;
      right[i] = (bytes[o++]! - 128) * PCMDecoder.SCALE_8;
    }
  }

  /**
   * Decodes 16-bit PCM mono audio, dispatching to LE/BE variant.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodePCM16Mono(view: DataView, out: Float32Array): void {
    this.isLittleEndian ? this.#decodePCM16MonoLE(view, out) : this.#decodePCM16MonoBE(view, out);
  }

  /**
   * Decodes 16-bit little-endian PCM mono audio.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM16MonoLE(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 2) {
      out[i] = view.getInt16(o, true) * PCMDecoder.SCALE_16;
    }
  }

  /**
   * Decodes 16-bit big-endian PCM mono audio.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM16MonoBE(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 2) {
      out[i] = view.getInt16(o, false) * PCMDecoder.SCALE_16;
    }
  }

  /**
   * Decodes 16-bit PCM stereo audio, dispatching to LE/BE variant.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodePCM16Stereo(view: DataView, left: Float32Array, right: Float32Array): void {
    this.isLittleEndian
      ? this.#decodePCM16StereoLE(view, left, right)
      : this.#decodePCM16StereoBE(view, left, right);
  }

  /**
   * Decodes 16-bit little-endian PCM stereo audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM16StereoLE(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 4) {
      left[i] = view.getInt16(o, true) * PCMDecoder.SCALE_16;
      right[i] = view.getInt16(o + 2, true) * PCMDecoder.SCALE_16;
    }
  }

  /**
   * Decodes 16-bit big-endian PCM stereo audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM16StereoBE(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 4) {
      left[i] = view.getInt16(o, false) * PCMDecoder.SCALE_16;
      right[i] = view.getInt16(o + 2, false) * PCMDecoder.SCALE_16;
    }
  }

  /**
   * Decodes 24-bit PCM mono audio, dispatching to LE/BE variant.
   * @param {Uint8Array} bytes - The raw byte buffer to decode.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodePCM24Mono(bytes: Uint8Array, out: Float32Array): void {
    this.isLittleEndian ? this.#decodePCM24MonoLE(bytes, out) : this.#decodePCM24MonoBE(bytes, out);
  }

  /**
   * Decodes 24-bit little-endian PCM mono audio.
   * @param {Uint8Array} bytes - The raw byte buffer to decode.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM24MonoLE(bytes: Uint8Array, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 3) {
      let v = (bytes[o + 2]! << 16) | (bytes[o + 1]! << 8) | bytes[o]!;
      v = (v << 8) >> 8; // Sign extension
      out[i] = v * PCMDecoder.SCALE_24;
    }
  }

  /**
   * Decodes 24-bit big-endian PCM mono audio.
   * @param {Uint8Array} bytes - The raw byte buffer to decode.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM24MonoBE(bytes: Uint8Array, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 3) {
      let v = (bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!;
      v = (v << 8) >> 8;
      out[i] = v * PCMDecoder.SCALE_24;
    }
  }

  /**
   * Decodes 24-bit PCM stereo audio, dispatching to LE/BE variant.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer to decode.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodePCM24Stereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    this.isLittleEndian
      ? this.#decodePCM24StereoLE(bytes, left, right)
      : this.#decodePCM24StereoBE(bytes, left, right);
  }

  /**
   * Decodes 24-bit little-endian PCM stereo audio.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer to decode.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM24StereoLE(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++) {
      let vL = (bytes[o + 2]! << 16) | (bytes[o + 1]! << 8) | bytes[o]!;
      vL = (vL << 8) >> 8;
      o += 3;
      let vR = (bytes[o + 2]! << 16) | (bytes[o + 1]! << 8) | bytes[o]!;
      vR = (vR << 8) >> 8;
      o += 3;
      left[i] = vL * PCMDecoder.SCALE_24;
      right[i] = vR * PCMDecoder.SCALE_24;
    }
  }

  /**
   * Decodes 24-bit big-endian PCM stereo audio.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer to decode.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM24StereoBE(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++) {
      let vL = (bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!;
      vL = (vL << 8) >> 8;
      o += 3;
      let vR = (bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!;
      vR = (vR << 8) >> 8;
      o += 3;
      left[i] = vL * PCMDecoder.SCALE_24;
      right[i] = vR * PCMDecoder.SCALE_24;
    }
  }

  /**
   * Decodes 32-bit PCM mono audio, dispatching to LE/BE variant.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodePCM32Mono(view: DataView, out: Float32Array): void {
    this.isLittleEndian ? this.#decodePCM32MonoLE(view, out) : this.#decodePCM32MonoBE(view, out);
  }

  /**
   * Decodes 32-bit little-endian PCM mono audio.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM32MonoLE(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 4) {
      out[i] = view.getInt32(o, true) * PCMDecoder.SCALE_32;
    }
  }

  /**
   * Decodes 32-bit big-endian PCM mono audio.
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   * @private
   */
  #decodePCM32MonoBE(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 4) {
      out[i] = view.getInt32(o, false) * PCMDecoder.SCALE_32;
    }
  }

  /**
   * Decodes 32-bit PCM stereo audio, dispatching to LE/BE variant.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodePCM32Stereo(view: DataView, left: Float32Array, right: Float32Array): void {
    this.isLittleEndian
      ? this.#decodePCM32StereoLE(view, left, right)
      : this.#decodePCM32StereoBE(view, left, right);
  }

  /**
   * Decodes 32-bit little-endian PCM stereo audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM32StereoLE(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 8) {
      left[i] = view.getInt32(o, true) * PCMDecoder.SCALE_32;
      right[i] = view.getInt32(o + 4, true) * PCMDecoder.SCALE_32;
    }
  }

  /**
   * Decodes 32-bit big-endian PCM stereo audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   * @private
   */
  #decodePCM32StereoBE(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 8) {
      left[i] = view.getInt32(o, false) * PCMDecoder.SCALE_32;
      right[i] = view.getInt32(o + 4, false) * PCMDecoder.SCALE_32;
    }
  }

  /**
   * Decodes 32-bit float mono audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodeFloat32Mono(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 4) {
      out[i] = Math.max(-1, Math.min(1, view.getFloat32(o, this.isLittleEndian)));
    }
  }

  /**
   * Decodes 32-bit float stereo audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodeFloat32Stereo(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 8) {
      left[i] = Math.max(-1, Math.min(1, view.getFloat32(o, this.isLittleEndian)));
      right[i] = Math.max(-1, Math.min(1, view.getFloat32(o + 4, this.isLittleEndian)));
    }
  }

  /**
   * Decodes 64-bit float mono audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the audio buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodeFloat64Mono(view: DataView, out: Float32Array): void {
    let o = 0;
    for (let i = 0; i < out.length; i++, o += 8) {
      out[i] = Math.max(-1, Math.min(1, view.getFloat64(o, this.isLittleEndian)));
    }
  }

  /**
   * Decodes 64-bit float stereo audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodeFloat64Stereo(view: DataView, left: Float32Array, right: Float32Array): void {
    let o = 0;
    for (let i = 0; i < left.length; i++, o += 16) {
      left[i] = Math.max(-1, Math.min(1, view.getFloat64(o, this.isLittleEndian)));
      right[i] = Math.max(-1, Math.min(1, view.getFloat64(o + 8, this.isLittleEndian)));
    }
  }

  /**
   * Decodes A-law encoded mono audio.
   * @param {Uint8Array} bytes - The A-law encoded byte buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodeAlaw(bytes: Uint8Array, out: Float32Array): void {
    const table = PCMDecoder.ALAW_TABLE;
    for (let i = 0; i < out.length; i++) {
      out[i] = table[bytes[i]!]!;
    }
  }

  /**
   * Decodes A-law encoded stereo audio.
   * @param {Uint8Array} bytes - The interleaved A-law encoded byte buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodeAlawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    const table = PCMDecoder.ALAW_TABLE;
    let o = 0;
    for (let i = 0; i < left.length; i++) {
      left[i] = table[bytes[o++]!]!;
      right[i] = table[bytes[o++]!]!;
    }
  }

  /**
   * Decodes µ-law encoded mono audio.
   * @param {Uint8Array} bytes - The µ-law encoded byte buffer.
   * @param {Float32Array} out - The output array for the decoded samples.
   */
  public decodeMulaw(bytes: Uint8Array, out: Float32Array): void {
    const table = PCMDecoder.MULAW_TABLE;
    for (let i = 0; i < out.length; i++) {
      out[i] = table[bytes[i]!]!;
    }
  }

  /**
   * Decodes µ-law encoded stereo audio.
   * @param {Uint8Array} bytes - The interleaved µ-law encoded byte buffer.
   * @param {Float32Array} left - The output array for the left channel.
   * @param {Float32Array} right - The output array for the right channel.
   */
  public decodeMulawStereo(bytes: Uint8Array, left: Float32Array, right: Float32Array): void {
    const table = PCMDecoder.MULAW_TABLE;
    let o = 0;
    for (let i = 0; i < left.length; i++) {
      left[i] = table[bytes[o++]!]!;
      right[i] = table[bytes[o++]!]!;
    }
  }

  /**
   * Decodes N-channel 8-bit PCM audio.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodePCM8N(bytes: Uint8Array, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++) {
        outs[ch]![i] = (bytes[o++]! - 128) * PCMDecoder.SCALE_8;
      }
    }
  }

  /**
   * Decodes N-channel 16-bit PCM audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodePCM16N(view: DataView, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++, o += 2) {
        outs[ch]![i] = view.getInt16(o, this.isLittleEndian) * PCMDecoder.SCALE_16;
      }
    }
  }

  /**
   * Decodes N-channel 24-bit PCM audio.
   * @param {Uint8Array} bytes - The interleaved raw byte buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodePCM24N(bytes: Uint8Array, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length,
      le = this.isLittleEndian;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++, o += 3) {
        let v = le
          ? (bytes[o + 2]! << 16) | (bytes[o + 1]! << 8) | bytes[o]!
          : (bytes[o]! << 16) | (bytes[o + 1]! << 8) | bytes[o + 2]!;
        v = (v << 8) >> 8;
        outs[ch]![i] = v * PCMDecoder.SCALE_24;
      }
    }
  }

  /**
   * Decodes N-channel 32-bit PCM audio.
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodePCM32N(view: DataView, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++, o += 4) {
        outs[ch]![i] = view.getInt32(o, this.isLittleEndian) * PCMDecoder.SCALE_32;
      }
    }
  }

  /**
   * Decodes N-channel 32-bit float audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodeFloat32N(view: DataView, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++, o += 4) {
        outs[ch]![i] = Math.max(-1, Math.min(1, view.getFloat32(o, this.isLittleEndian)));
      }
    }
  }

  /**
   * Decodes N-channel 64-bit float audio. Clamps samples to [-1, 1].
   * @param {DataView} view - The DataView wrapping the interleaved audio buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodeFloat64N(view: DataView, outs: Float32Array[]): void {
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++, o += 8) {
        outs[ch]![i] = Math.max(-1, Math.min(1, view.getFloat64(o, this.isLittleEndian)));
      }
    }
  }

  /**
   * Decodes N-channel A-law encoded audio.
   * @param {Uint8Array} bytes - The interleaved A-law encoded byte buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodeAlawN(bytes: Uint8Array, outs: Float32Array[]): void {
    const table = PCMDecoder.ALAW_TABLE;
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++) {
        outs[ch]![i] = table[bytes[o++]!]!;
      }
    }
  }

  /**
   * Decodes N-channel µ-law encoded audio.
   * @param {Uint8Array} bytes - The interleaved µ-law encoded byte buffer.
   * @param {Float32Array[]} outs - An array of output arrays, one for each channel.
   */
  public decodeMulawN(bytes: Uint8Array, outs: Float32Array[]): void {
    const table = PCMDecoder.MULAW_TABLE;
    const n = outs.length,
      samples = outs[0]!.length;
    let o = 0;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < n; ch++) {
        outs[ch]![i] = table[bytes[o++]!]!;
      }
    }
  }
}
