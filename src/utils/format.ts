import type { DataChunk, WavFormat } from '../types';

export function internalizeWavFormat(fmt: WavFormat): Required<
  Pick<WavFormat, 'bitsPerSample' | 'blockAlign' | 'bytesPerSecond' | 'channels' | 'formatTag' | 'sampleRate'>
> & {
  samplesPerBlock?: number;
  channelMask?: number;
  validBitsPerSample?: number;
  subFormat?: Uint8Array;
  extSize?: number;
  extraFields?: Uint8Array;
  resolvedFormatTag: number;
  isLittleEndian: boolean;
  bytesPerSample: number;
  dataChunks: DataChunk[];
  factChunkSamples?: number;
} {
  return {
    ...fmt,
    resolvedFormatTag: fmt.resolvedFormatTag ?? fmt.formatTag,
    isLittleEndian: fmt.isLittleEndian ?? true,
    bytesPerSample: fmt.bytesPerSample ?? fmt.bitsPerSample / 8,
    dataChunks: fmt.dataChunks ?? [],
    factChunkSamples: fmt.factChunkSamples,
  };
}
