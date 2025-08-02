import type { DataChunk, WavFormat, WavHeaderParserResult } from '../types.ts';
import {
  DATA_CHUNK,
  FMT_CHUNK,
  RIFF_SIGNATURE,
  RIFX_SIGNATURE,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IMA_ADPCM,
  WAVE_SIGNATURE,
} from '../constants.ts';

export interface ParseOptions {
  maxChunks?: number;
}

export const EMPTY_WAV_HEADER_RESULT: WavHeaderParserResult = {
  isLittleEndian: true,
  isExtensible: false,
  format: null,
  dataBytes: 0,
  dataOffset: 0,
  totalSamples: 0,
  totalFrames: 0,
  duration: 0,
  parsedChunks: [],
  unhandledChunks: [],
  dataChunks: [],
  errors: [],
} as const;

/**
 * Validates the RIFF header and determines endianness
 */
function validateRiffHeader(view: DataView): { isLittleEndian: boolean; errors: string[] } {
  const errors: string[] = [];

  const riffSig = view.getUint32(0, true);
  if (riffSig === RIFF_SIGNATURE) {
    return { isLittleEndian: true, errors };
  }

  const rifxSig = view.getUint32(0, false);
  if (rifxSig === RIFX_SIGNATURE) {
    return { isLittleEndian: false, errors };
  }

  errors.push('Missing RIFF or RIFX signature at byte 0');
  return { isLittleEndian: true, errors };
}

/**
 * Parses the format chunk and extracts audio format information
 */
function parseFormatChunk(
  buffer: Uint8Array,
  view: DataView,
  offset: number,
  actualChunkSize: number,
  isLittleEndian: boolean
): { format: WavFormat; isExtensible: boolean; errors: string[] } {
  const errors: string[] = [];

  if (actualChunkSize < 16) {
    errors.push('"fmt " chunk is too small (expected at least 16 bytes)');
    return { format: null as any, isExtensible: false, errors };
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
  let isExtensible = false;

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
      } else {
        errors.push('WAVE_FORMAT_EXTENSIBLE chunk is truncated');
      }
    } else if (formatTag === WAVE_FORMAT_IMA_ADPCM && extSize >= 2 && actualChunkSize >= 20) {
      if (extStart + 2 <= maxEnd) {
        samplesPerBlock = view.getUint16(extStart, isLittleEndian);
      } else {
        errors.push('IMA ADPCM format chunk is truncated');
      }
    }

    const extEnd = extStart + extSize;
    const safeExtEnd = Math.min(extEnd, maxEnd);
    if (safeExtEnd > extStart) {
      extraFields = buffer.slice(extStart, safeExtEnd);
    }
  }

  const format: WavFormat = {
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

  return { format, isExtensible, errors };
}

/**
 * Calculates total frames based on format and data size
 */
export function calculateTotalFrames(format: WavFormat | null, dataBytes: number): number {
  if (!format || format.blockAlign <= 0) {
    return 0;
  }

  if (format.formatTag === WAVE_FORMAT_IMA_ADPCM && format.samplesPerBlock && format.blockAlign > 0) {
    const numBlocks = Math.floor(dataBytes / format.blockAlign);
    return numBlocks * format.samplesPerBlock;
  }

  return Math.floor(dataBytes / format.blockAlign);
}

/**
 * Performs strict validation on the parsed format
 */
export function validateFormat(format: WavFormat | null = null, strict: boolean = true): string[] {
  const errors: string[] = [];

  if (!format) return errors;

  if (format.channels === 0) {
    errors.push('Invalid format: 0 channels');
  } else if (strict && format.channels > 32) {
    errors.push(`Invalid format: too many channels (${format.channels})`);
  }

  if (format.sampleRate === 0) {
    errors.push('Invalid format: 0 Hz sample rate');
  } else if (strict && format.sampleRate > 192000) {
    errors.push(`Invalid format: sample rate too high (${format.sampleRate} Hz)`);
  }

  if (format.bitsPerSample === 0) {
    errors.push('Invalid format: 0 bits per sample');
  } else if (strict && format.bitsPerSample % 8 !== 0) {
    errors.push(`Invalid format: non-byte-aligned bits per sample (${format.bitsPerSample})`);
  }

  if (strict) {
    const expectedBytesPerSecond = format.sampleRate * format.blockAlign;
    if (format.bytesPerSecond !== expectedBytesPerSecond) {
      errors.push(`Invalid format: bytes per second mismatch (${format.bytesPerSecond} vs ${expectedBytesPerSecond})`);
    }
  }

  return errors;
}

export function parseWavHeader(buffer: Uint8Array, options: ParseOptions = {}): WavHeaderParserResult {
  const maxChunks = options.maxChunks ?? Number.POSITIVE_INFINITY;
  const errors: string[] = [];
  const len = buffer.length;

  if (len < 12) {
    errors.push('File is too small to be a valid WAV (expected at least 12 bytes)');
    return { ...EMPTY_WAV_HEADER_RESULT, errors };
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const { isLittleEndian, errors: riffErrors } = validateRiffHeader(view);
  errors.push(...riffErrors);
  if (riffErrors.length > 0) {
    return { ...EMPTY_WAV_HEADER_RESULT, errors };
  }

  const waveStr = String.fromCharCode(...buffer.subarray(8, 12));
  if (waveStr !== WAVE_SIGNATURE) {
    errors.push('Missing "WAVE" signature at byte 8');
    return { ...EMPTY_WAV_HEADER_RESULT, errors };
  }

  let offset = 12;
  let format: WavFormat | null = null;
  let isExtensible = false;
  const dataChunks: DataChunk[] = [];
  const parsedChunks: DataChunk[] = [];
  const unhandledChunks: DataChunk[] = [];
  let chunkCount = 0;

  while (offset + 8 <= len && chunkCount < maxChunks) {
    const chunkStr = String.fromCharCode(...buffer.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, isLittleEndian);
    const paddedSize = chunkSize + (chunkSize & 1);
    const available = len - (offset + 8);
    const actualChunkSize = Math.min(available, chunkSize);

    parsedChunks.push({ id: chunkStr, offset, size: actualChunkSize });

    if (actualChunkSize < chunkSize) {
      errors.push(
        `Chunk "${chunkStr}" at byte ${offset} appears truncated in stream (${actualChunkSize}/${chunkSize} bytes available)`
      );
      break;
    }

    if (chunkStr === FMT_CHUNK) {
      const {
        format: parsedFormat,
        isExtensible: ext,
        errors: fmtErrors,
      } = parseFormatChunk(buffer, view, offset, actualChunkSize, isLittleEndian);
      format = parsedFormat;
      isExtensible = ext;
      errors.push(...fmtErrors);

      if (fmtErrors.length > 0) break;
    } else if (chunkStr === DATA_CHUNK) {
      dataChunks.push({ id: DATA_CHUNK, offset: offset + 8, size: actualChunkSize });
    } else {
      unhandledChunks.push({ id: chunkStr, offset, size: actualChunkSize });
    }

    if (actualChunkSize < chunkSize) {
      break;
    }

    offset += 8 + paddedSize;
    chunkCount++;
  }

  if (!format) {
    errors.push('Missing required "fmt " chunk');
  }

  const formatValidationErrors = validateFormat(format);
  errors.push(...formatValidationErrors);

  const dataBytes = dataChunks.reduce((n, c) => n + c.size, 0);
  const dataOffset = dataChunks[0]?.offset || 0;
  const totalFrames = calculateTotalFrames(format, dataBytes);
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
    errors,
  };
}
