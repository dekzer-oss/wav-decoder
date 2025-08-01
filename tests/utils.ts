import {
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_FORMAT_PCM,
} from '../src/parseWavHeader';
import type { WavHeaderParserResult } from '../src';

/**
 * Returns the total number of PCM samples (not frames) described by this header.
 * For PCM: samples = frames * channels.
 * For IMA ADPCM: samples = blocks * samplesPerBlock.
 * Returns 0 if unknown or invalid.
 */
export function expectedSamples(header: WavHeaderParserResult): number {
  const fmt = header.format;
  if (!fmt || !header.dataBytes || !fmt.blockAlign || fmt.channels < 1) return 0;

  if (fmt.formatTag === WAVE_FORMAT_IMA_ADPCM) {
    const blocks = Math.floor(header.dataBytes / fmt.blockAlign);
    return blocks * (fmt.samplesPerBlock || 0);
  } else {
    const frames = Math.floor(header.dataBytes / fmt.blockAlign);
    return frames * fmt.channels;
  }
}

export function getDuration(header: WavHeaderParserResult): number {
  const { format, dataBytes } = header;
  if (!format?.blockAlign || !format?.sampleRate || format.sampleRate === 0) return 0;
  const frames = Math.floor(dataBytes / format.blockAlign);
  return frames / format.sampleRate;
}

export function getNumFrames(header: WavHeaderParserResult): number {
  const { format, dataBytes } = header;
  if (!format?.blockAlign) return 0;
  return Math.floor(dataBytes / format.blockAlign);
}

export function getBlockAlign(header: WavHeaderParserResult): number {
  const { format } = header;
  if (!format) return 0;
  if (format.blockAlign > 0) return format.blockAlign;
  if (format.channels && format.bitsPerSample) return Math.floor((format.channels * format.bitsPerSample) / 8);
  return 0;
}

export function isPCM(header: WavHeaderParserResult): boolean {
  const tag = header.format?.formatTag;
  return tag === WAVE_FORMAT_PCM || tag === WAVE_FORMAT_IEEE_FLOAT;
}

export function getChannels(header: WavHeaderParserResult): number {
  return header.format?.channels || 1;
}

export function chunkPCMData(data: Float32Array[], chunkFrames: number): Float32Array[][] {
  if (!data.length || chunkFrames <= 0) return [];
  const length = data[0]!.length;
  const result: Float32Array[][] = [];
  for (let i = 0; i < length; i += chunkFrames) {
    result.push(data.map((ch) => ch.subarray(i, i + chunkFrames)));
  }
  return result;
}
