import type { DataChunk, WavFormat, WavHeaderParserResult } from './types';
import {
  DATA_CHUNK,
  FMT_CHUNK,
  RIFF_SIGNATURE,
  RIFX_SIGNATURE,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_SIGNATURE,
} from './constants.ts';

export const EMPTY_WAV_HEADER_RESULT: WavHeaderParserResult = {
  isLittleEndian: true,
  format: null,
  isExtensible: false,
  dataBytes: 0,
  dataOffset: 0,
  parsedChunks: [],
  unhandledChunks: [],
  totalSamples: 0,
  totalFrames: 0,
  duration: 0,
  dataChunks: [],
  warnings: [],
  errors: [],
} as const;

export function parseWavHeader(buffer: Uint8Array): WavHeaderParserResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const len = buffer.length;

  if (len < 12) {
    errors.push('File is too small to be a valid WAV (expected at least 12 bytes)');
    return { ...EMPTY_WAV_HEADER_RESULT, errors, warnings };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let isLittleEndian = false;
  const riffSig = view.getUint32(0, true);
  if (riffSig === RIFF_SIGNATURE) {
    isLittleEndian = true;
  } else {
    const rifxSig = view.getUint32(0, false);
    if (rifxSig === RIFX_SIGNATURE) {
      isLittleEndian = false;
    } else {
      errors.push('Missing RIFF or RIFX signature at byte 0');
      return { ...EMPTY_WAV_HEADER_RESULT, errors, warnings };
    }
  }

  // const fileSize = view.getUint32(4, isLittleEndian);
  // if (fileSize + 8 !== len) {
  //   warnings.push(`Declared file size (${fileSize + 8} bytes) does not match actual buffer size (${len} bytes)`);
  // }

  const waveStr = String.fromCharCode(...buffer.subarray(8, 12));
  if (waveStr !== WAVE_SIGNATURE) {
    errors.push('Missing "WAVE" signature at byte 8');
    return { ...EMPTY_WAV_HEADER_RESULT, errors, warnings };
  }

  let offset = 12;
  let format: WavFormat | null = null;
  const dataChunks: DataChunk[] = [];
  const parsedChunks: DataChunk[] = [];
  const unhandledChunks: DataChunk[] = [];
  let isExtensible = false;

  while (offset + 8 <= len) {
    const chunkStr = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, isLittleEndian);
    const paddedSize = chunkSize + (chunkSize & 1);
    const available = len - (offset + 8);
    const actualChunkSize = available < chunkSize ? available : chunkSize;

    parsedChunks.push({ id: chunkStr, offset, size: actualChunkSize });

    if (actualChunkSize < chunkSize) {
      warnings.push(
        `Unexpected end of file in "${chunkStr}" chunk at byte ${offset}. ` +
          `Expected ${chunkSize} bytes, but only ${actualChunkSize} byte${actualChunkSize !== 1 ? 's' : ''} available.`
      );
    }

    if (chunkStr === FMT_CHUNK) {
      if (actualChunkSize < 16) {
        errors.push('"fmt " chunk is too small (expected at least 16 bytes)');
        break;
      }

      const off = offset + 8;
      const formatTag = view.getUint16(off, isLittleEndian);
      const channels = view.getUint16(off + 2, isLittleEndian);
      const sampleRate = view.getUint32(off + 4, isLittleEndian);
      const bytesPerSecond = view.getUint32(off + 8, isLittleEndian);
      const blockAlign = view.getUint16(off + 12, isLittleEndian);
      const bitsPerSample = view.getUint16(off + 14, isLittleEndian);

      let samplesPerBlock: number | undefined;
      let channelMask: number | undefined;
      let validBitsPerSample: number | undefined;
      let subFormat: Uint8Array | undefined;
      let extSize: number | undefined;
      let extraFields: Uint8Array | undefined;

      if (actualChunkSize >= 18) {
        extSize = view.getUint16(off + 16, isLittleEndian);
        const extStart = off + 18;
        const maxEnd = Math.min(off + actualChunkSize, buffer.length);

        if (formatTag === WAVE_FORMAT_EXTENSIBLE && extSize >= 22 && actualChunkSize >= 40) {
          if (extStart + 22 <= maxEnd) {
            isExtensible = true;
            validBitsPerSample = view.getUint16(extStart, isLittleEndian);
            channelMask = view.getUint32(extStart + 2, isLittleEndian);
            subFormat = buffer.slice(extStart + 6, extStart + 22);
          }
        } else if (formatTag === WAVE_FORMAT_IMA_ADPCM && extSize >= 2 && actualChunkSize >= 20) {
          if (extStart + 2 <= maxEnd) {
            samplesPerBlock = view.getUint16(extStart, isLittleEndian);
          }
        }

        const extEnd = extStart + extSize;
        const safeExtEnd = Math.min(extEnd, maxEnd);
        if (safeExtEnd > extStart) {
          extraFields = buffer.slice(extStart, safeExtEnd);
        }
      }

      format = {
        bitsPerSample,
        blockAlign,
        bytesPerSecond,
        channels,
        formatTag,
        sampleRate,
        samplesPerBlock,
        channelMask,
        validBitsPerSample,
        subFormat,
        extSize,
        extraFields,
      };
    } else if (chunkStr === DATA_CHUNK) {
      dataChunks.push({ id: DATA_CHUNK, offset: offset + 8, size: actualChunkSize });
    } else {
      unhandledChunks.push({ id: chunkStr, offset, size: actualChunkSize });
    }

    if (actualChunkSize < chunkSize) break;
    offset += 8 + paddedSize;
  }

  if (!format) {
    errors.push('Missing required "fmt " chunk');
  }

  if (dataChunks.length === 0) {
    warnings.push('Missing "data" chunk — no audio payload found');
  }

  const dataBytes = dataChunks.reduce((n, c) => n + c.size, 0);
  const dataOffset = dataChunks[0]?.offset || 0;

  let totalFrames = 0;
  if (format && format.blockAlign > 0) {
    totalFrames = Math.floor(dataBytes / format.blockAlign);
  }
  if (format && format.formatTag === WAVE_FORMAT_IMA_ADPCM && format.samplesPerBlock && format.blockAlign > 0) {
    const numBlocks = Math.floor(dataBytes / format.blockAlign);
    totalFrames = numBlocks * format.samplesPerBlock;
  }

  const totalSamples = format ? totalFrames * format.channels : 0;
  const duration = format && format.sampleRate > 0 ? totalFrames / format.sampleRate : 0;

  return {
    isLittleEndian,
    format,
    isExtensible,
    dataBytes,
    dataOffset,
    parsedChunks,
    unhandledChunks,
    totalSamples,
    totalFrames,
    duration,
    dataChunks,
    warnings,
    errors,
  };
}
