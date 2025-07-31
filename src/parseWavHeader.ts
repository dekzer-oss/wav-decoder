import type { ChunkInfo, DataChunk, WavFormat, WavHeaderParserResult } from './types';

export const RIFF_SIGNATURE = 0x46464952 as const;
export const RIFX_SIGNATURE = 0x52494658 as const;
export const WAVE_SIGNATURE = 0x45564157 as const;
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe as const;
export const WAVE_FORMAT_IMA_ADPCM = 0x0011 as const;
export const WAVE_FORMAT_PCM = 0x0001 as const;
export const FMT_CHUNK = 'fmt ' as const;
export const DATA_CHUNK = 'data' as const;
export function parseWavHeader(buffer: Uint8Array): WavHeaderParserResult {
  const warnings: string[] = [];
  const len = buffer.length;
  if (len < 12) throw new Error('File is too small to be a valid WAV (expected at least 12 bytes)');

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let isLE = false;
  const riffSig = view.getUint32(0, true);
  if (riffSig === RIFF_SIGNATURE) {
    isLE = true;
  } else {
    const rifxSig = view.getUint32(0, false);
    if (rifxSig === RIFX_SIGNATURE) {
      isLE = false;
    } else {
      throw new Error('Missing RIFF or RIFX signature at byte 0');
    }
  }

  const fileSize = view.getUint32(4, isLE);
  if (fileSize + 8 !== len) {
    warnings.push(`Declared file size (${fileSize + 8} bytes) does not match actual buffer size (${len} bytes)`);
  }

  const waveWord = view.getUint32(8, true);
  if (waveWord !== WAVE_SIGNATURE) {
    throw new Error('Missing "WAVE" signature at byte 8');
  }

  let offset = 12;
  let format: WavFormat | undefined;
  let dataChunks: DataChunk[] = [];
  const parsedChunks: ChunkInfo[] = [];
  const unhandledChunks: ChunkInfo[] = [];
  let isExtensible = false;

  while (offset + 8 <= len) {
    const chunkStr = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, isLE);
    const paddedSize = chunkSize + (chunkSize & 1);

    if (offset + 8 + chunkSize > len) {
      const available = Math.max(0, len - (offset + 8));

      warnings.push(
        `Unexpected end of file in "${chunkStr}" chunk at byte ${offset}. ` +
          `Expected ${chunkSize} bytes, but only ${available} byte${available !== 1 ? 's' : ''} available.`
      );

      if (chunkStr === FMT_CHUNK) {
        throw new Error('Incomplete "fmt " chunk — not enough bytes to parse format');
      }

      if (chunkStr === DATA_CHUNK) {
        if (format?.formatTag === WAVE_FORMAT_IMA_ADPCM) {
          dataChunks.push({ offset: offset + 8, size: chunkSize });
          parsedChunks.push({ id: chunkStr, offset, size: chunkSize });
        } else {
          dataChunks.push({ offset: offset + 8, size: available });
          parsedChunks.push({ id: chunkStr, offset, size: available });
        }
      } else {
        unhandledChunks.push({ id: chunkStr, offset, size: available });
        parsedChunks.push({ id: chunkStr, offset, size: available });
      }

      break;
    }

    parsedChunks.push({ id: chunkStr, offset, size: chunkSize });

    if (chunkStr === FMT_CHUNK) {
      if (chunkSize < 16) {
        throw new Error('"fmt " chunk is too small (expected at least 16 bytes)');
      }

      const off = offset + 8;
      const formatTag = view.getUint16(off, isLE);
      const channels = view.getUint16(off + 2, isLE);
      const sampleRate = view.getUint32(off + 4, isLE);
      const bytesPerSecond = view.getUint32(off + 8, isLE);
      const blockAlign = view.getUint16(off + 12, isLE);
      const bitsPerSample = view.getUint16(off + 14, isLE);

      let samplesPerBlock: number | undefined;
      let channelMask: number | undefined;
      let validBitsPerSample: number | undefined;
      let subFormat: Uint8Array | undefined;
      let extSize: number | undefined;
      let extraFields: Uint8Array | undefined;

      if (chunkSize >= 18) {
        extSize = view.getUint16(off + 16, isLE);
        const extStart = off + 18;
        const maxEnd = Math.min(off + chunkSize, buffer.length);

        if (formatTag === WAVE_FORMAT_EXTENSIBLE && extSize >= 22 && chunkSize >= 40) {
          if (extStart + 22 <= maxEnd) {
            isExtensible = true;
            validBitsPerSample = view.getUint16(extStart, isLE);
            channelMask = view.getUint32(extStart + 2, isLE);
            subFormat = buffer.slice(extStart + 6, extStart + 22);
          }
        } else if (formatTag === WAVE_FORMAT_IMA_ADPCM && extSize >= 2 && chunkSize >= 20) {
          if (extStart + 2 <= maxEnd) {
            samplesPerBlock = view.getUint16(extStart, isLE);
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
      dataChunks.push({ offset: offset + 8, size: chunkSize });
    } else {
      unhandledChunks.push({ id: chunkStr, offset, size: chunkSize });
    }

    offset += 8 + paddedSize;
  }

  if (!format) throw new Error('Missing required "fmt " chunk');
  if (dataChunks.length === 0) warnings.push('Missing "data" chunk — no audio payload found');

  const dataBytes = dataChunks.reduce((n, c) => n + c.size, 0);
  const dataOffset = dataChunks[0]?.offset || 0;

  let totalFrames = 0;
  if (format.blockAlign > 0) {
    totalFrames = Math.floor(dataBytes / format.blockAlign);
  }
  if (format.formatTag === WAVE_FORMAT_IMA_ADPCM && format.samplesPerBlock && format.blockAlign > 0) {
    const numBlocks = Math.floor(dataBytes / format.blockAlign);
    totalFrames = numBlocks * format.samplesPerBlock;
  }

  const totalSamples = totalFrames * (format.channels || 0);
  const duration = format.sampleRate > 0 ? totalFrames / format.sampleRate : 0;

  return {
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
  };
}
