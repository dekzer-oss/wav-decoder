import { IMA_INDEX_ADJUST_TABLE, IMA_STEP_TABLE, INV_32768 } from '../../constants.ts';

/**
 * Decodes a single IMA ADPCM block (WAV standard layout: interleaved nibbles per channel)
 * and writes PCM samples directly into the provided Float32Array buffers.
 *
 * @param compressed      Uint8Array containing the compressed ADPCM block (without header)
 * @param headers         Array of {predictor, stepIndex} for each channel
 * @param samplesPerBlock Number of output PCM samples per channel (including predictor)
 * @param channels        Number of channels in this block
 * @param outputOffset    Sample offset to start writing into each channel buffer
 * @param channelData          Array of Float32Array channel buffers to write decoded PCM samples into
 */
export function decodeIMAADPCMBlock(
  compressed: Uint8Array,
  headers: { predictor: number; stepIndex: number }[],
  samplesPerBlock: number,
  channels: number,
  outputOffset: number,
  channelData: Float32Array[]
): void {
  // Guard: buffer setup
  for (let ch = 0; ch < channels; ch++) {
    if (!channelData[ch] || channelData[ch].length < outputOffset + samplesPerBlock) return;
    // Set first sample (predictor)
    channelData[ch][outputOffset] = headers[ch].predictor * INV_32768;
  }

  const predictors = headers.map((h) => h.predictor);
  const stepIndices = headers.map((h) => Math.min(88, Math.max(0, h.stepIndex)));

  let sampleIndex = 1; // First sample already written (predictor)
  let nibbleIndex = 0; // Advances through every 4 bits in the block

  const totalNibbles = (samplesPerBlock - 1) * channels;

  // Each nibble yields a sample for its channel in round-robin order
  for (let byteIndex = 0; byteIndex < compressed.length; byteIndex++) {
    const byte = compressed[byteIndex]!;
    for (let n = 0; n < 2; n++) {
      // low then high nibble
      if (sampleIndex >= samplesPerBlock) break;

      const nibble = n === 0 ? byte & 0x0f : (byte >> 4) & 0x0f;
      const ch = nibbleIndex % channels;

      let step = IMA_STEP_TABLE[stepIndices[ch]] ?? 0;
      let diff = step >> 3;
      if (nibble & 1) diff += step >> 2;
      if (nibble & 2) diff += step >> 1;
      if (nibble & 4) diff += step;
      if (nibble & 8) diff = -diff;

      predictors[ch] += diff;
      predictors[ch] = Math.max(-32768, Math.min(32767, predictors[ch]));

      stepIndices[ch] += IMA_INDEX_ADJUST_TABLE[nibble & 7];
      stepIndices[ch] = Math.max(0, Math.min(88, stepIndices[ch]));

      // Write to output (with protection)
      const outIdx = outputOffset + sampleIndex;
      if (outIdx < channelData[ch].length) {
        channelData[ch][outIdx] = predictors[ch] * INV_32768;
      }
      nibbleIndex++;
      if (ch === channels - 1) sampleIndex++;
    }
    if (sampleIndex >= samplesPerBlock) break;
  }
}
