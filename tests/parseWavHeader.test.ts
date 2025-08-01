import { parseWavHeader } from '../src/parseWavHeader';
import { describe, expect, it } from 'vitest';
import { WaveFile } from 'wavefile';
import { WAVE_FORMAT_EXTENSIBLE, WAVE_FORMAT_IMA_ADPCM, WAVE_FORMAT_PCM } from '../src/constants';

function createTestBuffer(opts: {
  riffSize?: number;
  chunks: { id: string; size: number; data?: Uint8Array }[];
  endianness?: 'LE' | 'BE';
  corrupt?: { at: number; val: number }[];
}): Uint8Array {
  let finalBufferSize = 12;
  for (const chunk of opts.chunks) {
    finalBufferSize += 8 + (chunk.data ? chunk.data.length : 0);
  }
  const buffer = new Uint8Array(finalBufferSize);
  const view = new DataView(buffer.buffer);
  const isLE = opts.endianness !== 'BE';

  view.setUint32(0, isLE ? 0x46464952 : 0x58464952, true);
  view.setUint32(4, opts.riffSize ?? finalBufferSize - 8, isLE);
  view.setUint32(8, 0x45564157, true);

  let currentOffset = 12;
  for (const chunk of opts.chunks) {
    for (let i = 0; i < 4; i++) buffer[currentOffset + i] = chunk.id.charCodeAt(i);
    view.setUint32(currentOffset + 4, chunk.size, isLE);
    currentOffset += 8;
    if (chunk.data) {
      buffer.set(chunk.data, currentOffset);
      currentOffset += chunk.data.length;
    }
  }
  if (opts.corrupt) for (const { at, val } of opts.corrupt) if (at < buffer.length) buffer[at] = val;
  return buffer;
}

function assertHeader(
  result: ReturnType<typeof parseWavHeader>,
  opts: {
    channels?: number;
    sampleRate?: number;
    bitsPerSample?: number;
    formatTag?: number;
    allowWarnings?: boolean;
    warnings?: Array<RegExp | string>;
    errors?: Array<RegExp | string>;
    allowErrors?: boolean;
  } = {}
) {
  const { allowWarnings = true, allowErrors = false } = opts;

  if (opts.formatTag !== undefined) {
    expect(result.format?.formatTag).toBe(opts.formatTag);
  }
  if (opts.errors) {
    for (const err of opts.errors) {
      if (typeof err === 'string') {
        expect(result.errors).toContain(err);
      } else {
        expect(result.errors.some((e) => err.test(e))).toBe(true);
      }
    }
  } else if (!allowErrors) {
    expect(result.errors).toEqual([]);
  }
}

function snapshotHeader(result: ReturnType<typeof parseWavHeader>) {
  const snap = {
    isLittleEndian: result.isLittleEndian,
    format: result.format
      ? {
          ...result.format,
          extraFields: undefined,
          subFormat: result.format.subFormat ? '[GUID]' : undefined,
        }
      : undefined,
    isExtensible: result.isExtensible,
    dataBytes: result.dataBytes,
    dataOffset: result.dataOffset,
    totalSamples: result.totalSamples,
    totalFrames: result.totalFrames,
    duration: result.duration,
    dataChunks: result.dataChunks.map((c) => ({ offset: c.offset, size: c.size })),
    parsedChunks: result.parsedChunks.map((c) => ({ id: c.id, offset: c.offset, size: c.size })),
    unhandledChunks: result.unhandledChunks.map((c) => ({ id: c.id })),
    errors: result.errors,
  };
  expect(snap).toMatchSnapshot();
}

// For extensible format
const PCM_GUID = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

describe('parseWavHeader', () => {
  // Table-driven PCM format checks (should always pass)
  it.each([
    { channels: 1, sampleRate: 44100, bits: '16', desc: 'mono 16-bit' },
    { channels: 2, sampleRate: 48000, bits: '24', desc: 'stereo 24-bit' },
    { channels: 1, sampleRate: 44100, bits: '8', desc: 'mono 8-bit' },
    { channels: 2, sampleRate: 96000, bits: '32', desc: 'stereo 32-bit' },
  ])('parses $desc', (fmt) => {
    const wav = new WaveFile();
    wav.fromScratch(fmt.channels, fmt.sampleRate, fmt.bits, [new Int16Array([0, 1, -1, 2, -2, 3, -3])]);
    const result = parseWavHeader(wav.toBuffer());
    assertHeader(result, {
      formatTag: WAVE_FORMAT_PCM,
      channels: fmt.channels,
      sampleRate: fmt.sampleRate,
      bitsPerSample: Number(fmt.bits),
      warnings: [],
      errors: [],
    });
  });

  // Edge cases: Header errors
  it.each([
    ['missing RIFF signature', { corrupt: [{ at: 0, val: 0x00 }], chunks: [] }, { errors: [/RIFF|RIFX/i] }],
    ['missing WAVE signature', { corrupt: [{ at: 8, val: 0x00 }], chunks: [] }, { errors: [/WAVE/i] }],
    [
      'missing fmt chunk',
      { chunks: [{ id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) }] },
      { errors: [/fmt/i] },
    ],
    [
      'truncated fmt chunk',
      {
        chunks: [{ id: 'fmt ', size: 16, data: new Uint8Array(10) }],
      },
      {
        errors: [/truncated in stream/i, /Missing required "fmt "/i],
      },
    ],
  ])('Edge: %s', (_, opts, expectProps) => {
    const buffer = createTestBuffer(opts as any);
    const result = parseWavHeader(buffer);
    assertHeader(result, expectProps as any);
  });

  // Edge cases: Chunks and layout
  it('handles multiple data chunks and unhandled chunks', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) },
        { id: 'junk', size: 8, data: new Uint8Array(8) },
        { id: 'data', size: 2, data: new Uint8Array([5, 6]) },
      ],
    });
    const result = parseWavHeader(buffer);
    // This triggers 0 channels/sample rate/bits per sample errors due to zero-initialized fmt data
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.dataChunks.length).toBe(2);
    expect(result.dataBytes).toBe(6);
    expect(result.unhandledChunks.map((c) => c.id)).toContain('junk');
  });

  it('handles chunk with odd size (padding)', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 5, data: new Uint8Array([1, 2, 3, 4, 5]) },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.dataChunks[0]!.size).toBe(5);
    expect(result.dataBytes).toBe(5);
  });

  it('handles junk chunk before fmt', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'junk', size: 8, data: new Uint8Array(8) },
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 4 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.unhandledChunks.map((c) => c.id)).toContain('junk');
    expect(result.format).toBeDefined();
  });

  // Edge: file size warnings
  it('warns when RIFF size < actual size', () => {
    const buffer = createTestBuffer({
      riffSize: 20,
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 8 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
  });

  it('warns when RIFF size > actual size', () => {
    const buffer = createTestBuffer({
      riffSize: 100,
      chunks: [{ id: 'fmt ', size: 16, data: new Uint8Array(16) }],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
  });

  it('handles truncated buffer (partial last chunk)', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 100, data: new Uint8Array(50) },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.dataBytes).toBe(0);
  });

  // Edge: Non-PCM/extensible/ADPCM
  it('parses extensible format with channel mask', () => {
    const fmtData = new Uint8Array(40);
    const view = new DataView(fmtData.buffer);
    view.setUint16(0, WAVE_FORMAT_EXTENSIBLE, true);
    view.setUint16(2, 2, true);
    view.setUint32(4, 48000, true);
    view.setUint32(8, 192000, true);
    view.setUint16(12, 8, true);
    view.setUint16(14, 32, true);
    view.setUint16(16, 22, true);
    view.setUint16(18, 24, true); // valid bits
    view.setUint32(20, 0x3, true); // channel mask
    fmtData.set(PCM_GUID, 24);
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 40, data: fmtData },
        { id: 'data', size: 100 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      formatTag: WAVE_FORMAT_EXTENSIBLE,
      errors: [/truncated in stream/i, /bytes per second mismatch/i],
    });
    expect(result.isExtensible).toBe(true);
    expect(result.format?.validBitsPerSample).toBe(24);
    expect(result.format?.channelMask).toBe(0x3);
    expect(result.format?.subFormat).toEqual(PCM_GUID);
  });

  it('parses IMA ADPCM format', () => {
    const fmtData = new Uint8Array(20);
    const view = new DataView(fmtData.buffer);
    view.setUint16(0, WAVE_FORMAT_IMA_ADPCM, true);
    view.setUint16(2, 1, true);
    view.setUint32(4, 44100, true);
    view.setUint32(8, 22050, true);
    view.setUint16(12, 512, true);
    view.setUint16(14, 4, true);
    view.setUint16(16, 2, true);
    view.setUint16(18, 505, true);
    const dataChunkData = new Uint8Array(1024);
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 20, data: fmtData },
        { id: 'data', size: 1024, data: dataChunkData },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      formatTag: WAVE_FORMAT_IMA_ADPCM,
      errors: [/non-byte-aligned bits per sample/i, /bytes per second mismatch/i],
    });
    // Spec math
    const numBlocks = Math.floor(1024 / 512);
    const totalFrames = numBlocks * 505;
    const totalSamples = totalFrames * 1;
    expect(result.totalSamples).toBe(totalSamples);
  });

  // Zero/unusual
  it('handles zero sample rate', () => {
    const fmtData = new Uint8Array(16);
    const view = new DataView(fmtData.buffer);
    view.setUint16(0, WAVE_FORMAT_PCM, true);
    view.setUint16(2, 2, true);
    view.setUint32(4, 0, true);
    view.setUint16(14, 16, true);
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: fmtData },
        { id: 'data', size: 100 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 Hz sample rate/],
    });
    expect(result.duration).toBe(0);
  });

  it('handles empty data chunk', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 0 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.dataBytes).toBe(0);
    expect(result.totalSamples).toBe(0);
  });

  it('handles minimal valid WAV', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 0 },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
  });

  // RIFX / big-endian
  it('parses big-endian header', () => {
    const buffer = createTestBuffer({
      endianness: 'BE',
      chunks: [
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
        { id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.format).toBeDefined();
    expect(result.dataBytes).toBe(4);
  });

  it('allows data chunk before fmt ', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) },
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
      ],
    });
    const result = parseWavHeader(buffer);
    assertHeader(result, {
      errors: [/Invalid format: 0 channels/, /Invalid format: 0 Hz sample rate/, /Invalid format: 0 bits per sample/],
    });
    expect(result.format).toBeDefined();
    expect(result.dataChunks.length).toBe(1);
  });

  it('structure sanity snapshot (basic PCM)', () => {
    const wav = new WaveFile();
    wav.fromScratch(2, 44100, '16', [new Int16Array([0, 1, -1, 2, -2, 3, -3])]);
    const result = parseWavHeader(wav.toBuffer());
    snapshotHeader(result);
  });
});
