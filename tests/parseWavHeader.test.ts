import { WaveFile } from 'wavefile';
import { parseWavHeader, WAVE_FORMAT_EXTENSIBLE, WAVE_FORMAT_IMA_ADPCM, WAVE_FORMAT_PCM } from '../src/parseWavHeader';
import { describe, expect, it } from 'vitest';

function createTestBuffer(opts: {
  riffSize?: number;
  chunks: {
    id: string;
    size: number;
    data?: Uint8Array;
  }[];
  endianness?: 'LE' | 'BE';
  corrupt?: { at: number; val: number }[];
}): Uint8Array {
  let finalBufferSize = 12;
  for (const chunk of opts.chunks) {
    finalBufferSize += 8;
    if (chunk.data) {
      finalBufferSize += chunk.data.length;
    }
    // We deliberately ignore padding for truncation tests.
  }

  const buffer = new Uint8Array(finalBufferSize);
  const view = new DataView(buffer.buffer);
  const isLE = opts.endianness !== 'BE';

  view.setUint32(0, isLE ? 0x46464952 : 0x58464952, true);
  view.setUint32(4, opts.riffSize ?? finalBufferSize - 8, isLE);
  view.setUint32(8, 0x45564157, true);

  let currentOffset = 12;
  for (const chunk of opts.chunks) {
    for (let i = 0; i < 4; i++) {
      buffer[currentOffset + i] = chunk.id.charCodeAt(i);
    }
    view.setUint32(currentOffset + 4, chunk.size, isLE);
    currentOffset += 8;

    if (chunk.data) {
      buffer.set(chunk.data, currentOffset);
      currentOffset += chunk.data.length;
    }
  }

  if (opts.corrupt) {
    for (const { at, val } of opts.corrupt) {
      if (at < buffer.length) buffer[at] = val;
    }
  }

  return buffer;
}

const PCM_GUID = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

describe('parseWavHeader', () => {
  describe('Standard PCM formats (using WaveFile)', () => {
    const formats = [
      {
        channels: 1,
        sampleRate: 44100,
        bits: '16',
        desc: 'mono 16-bit',
      },
      {
        channels: 2,
        sampleRate: 48000,
        bits: '24',
        desc: 'stereo 24-bit',
      },
      { channels: 1, sampleRate: 44100, bits: '8', desc: 'mono 8-bit' },
      {
        channels: 2,
        sampleRate: 96000,
        bits: '32',
        desc: 'stereo 32-bit',
      },
    ];

    formats.forEach(({ channels, sampleRate, bits, desc }) => {
      it(`parses ${desc}`, () => {
        const wav = new WaveFile();
        wav.fromScratch(channels, sampleRate, bits, [new Int16Array([0, 1, -1, 2, -2, 3, -3])]);

        const result = parseWavHeader(wav.toBuffer());

        expect(result.format.formatTag).toBe(WAVE_FORMAT_PCM);
        expect(result.format.channels).toBe(channels);
        expect(result.format.sampleRate).toBe(sampleRate);
        expect(result.format.bitsPerSample).toBe(parseInt(bits));
        expect(result.warnings).toEqual([]);
      });
    });
  });

  describe('Edge case: Invalid headers (hand-crafted)', () => {
    it('throws on missing RIFF signature', () => {
      const buffer = createTestBuffer({
        chunks: [],
        corrupt: [{ at: 0, val: 0x00 }], // Corrupt 'R'
      });
      expect(() => parseWavHeader(buffer)).toThrow('Missing RIFF or RIFX signature at byte 0');
    });

    it('throws on missing WAVE signature', () => {
      const buffer = createTestBuffer({
        chunks: [],
        corrupt: [{ at: 8, val: 0x00 }], // Corrupt 'W'
      });
      expect(() => parseWavHeader(buffer)).toThrow('Missing "WAVE" signature at byte 8');
    });

    it('throws on missing fmt chunk', () => {
      const buffer = createTestBuffer({
        chunks: [{ id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) }],
      });
      expect(() => parseWavHeader(buffer)).toThrow('Missing required "fmt " chunk');
    });

    it('throws on truncated fmt chunk', () => {
      const buffer = createTestBuffer({
        chunks: [
          {
            id: 'fmt ',
            size: 16,
            data: new Uint8Array(10), // Only 10 bytes instead of 16
          },
        ],
      });
      expect(() => parseWavHeader(buffer)).toThrow('"fmt " chunk is too small (expected at least 16 bytes)');
    });
  });

  describe('Edge case: Chunk handling (hand-crafted)', () => {
    it('handles multiple data chunks', () => {
      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 16, data: new Uint8Array(16) },
          {
            id: 'data',
            size: 4,
            data: new Uint8Array([1, 2, 3, 4]),
          },
          { id: 'junk', size: 8, data: new Uint8Array(8) },
          { id: 'data', size: 2, data: new Uint8Array([5, 6]) },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.dataChunks.length).toBe(2);
      expect(result.dataBytes).toBe(6);
      expect(result.unhandledChunks.length).toBe(1);
      expect(result.unhandledChunks[0]!.id).toBe('junk');
    });

    it('handles chunk with odd size (needs padding)', () => {
      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 16, data: new Uint8Array(16) },
          {
            id: 'data',
            size: 5,
            data: new Uint8Array([1, 2, 3, 4, 5]),
          },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.dataChunks[0]!.size).toBe(5);
      expect(result.dataBytes).toBe(5);
    });

    it('handles junk chunk before fmt', () => {
      const buffer = createTestBuffer({
        chunks: [
          { id: 'junk', size: 8, data: new Uint8Array(8) },
          {
            id: 'fmt ',
            size: 16,
            data: new Uint8Array(16),
          },
          { id: 'data', size: 4 },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.unhandledChunks.length).toBe(1);
      expect(result.unhandledChunks[0]!.id).toBe('junk');
      expect(result.format).toBeDefined();
    });
  });

  describe('Edge case: File size mismatches (hand-crafted)', () => {
    it('warns when RIFF size < actual size', () => {
      const buffer = createTestBuffer({
        riffSize: 20, // Smaller than actual
        chunks: [
          { id: 'fmt ', size: 16, data: new Uint8Array(16) },
          { id: 'data', size: 8 },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('warns when RIFF size > actual size', () => {
      const buffer = createTestBuffer({
        riffSize: 100,
        chunks: [{ id: 'fmt ', size: 16, data: new Uint8Array(16) }],
      });

      const result = parseWavHeader(buffer);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('handles truncated buffer (partial last chunk)', () => {
      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 16, data: new Uint8Array(16) },
          {
            id: 'data',
            size: 100,
            data: new Uint8Array(50), // Only 50 bytes instead of 100
          },
        ],
      });

      const result = parseWavHeader(buffer);
      // Expect actual available bytes (50) not declared size (100)
      expect(result.dataBytes).toBe(50);
    });
  });

  describe('Edge case: Non-PCM formats (hand-crafted)', () => {
    it('parses extensible format with channel mask', () => {
      const fmtData = new Uint8Array(40);
      const view = new DataView(fmtData.buffer);

      view.setUint16(0, WAVE_FORMAT_EXTENSIBLE, true); // Format tag
      view.setUint16(2, 2, true); // Channels
      view.setUint32(4, 48000, true); // Sample rate
      view.setUint32(8, 192000, true); // Bytes/sec
      view.setUint16(12, 8, true); // Block align
      view.setUint16(14, 32, true); // Bits/sample
      view.setUint16(16, 22, true); // Extension size

      // Extension (22 bytes)
      view.setUint16(18, 24, true); // Valid bits/sample
      view.setUint32(20, 0x3, true); // Channel mask (stereo)
      fmtData.set(PCM_GUID, 24); // Subformat GUID

      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 40, data: fmtData },
          { id: 'data', size: 100 },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.format.formatTag).toBe(WAVE_FORMAT_EXTENSIBLE);
      expect(result.isExtensible).toBe(true);
      expect(result.format.validBitsPerSample).toBe(24);
      expect(result.format.channelMask).toBe(0x3);
      expect(result.format.subFormat).toEqual(PCM_GUID);
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

      // Create actual data for the data chunk (1024 bytes)
      const dataChunkData = new Uint8Array(1024);

      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 20, data: fmtData },
          { id: 'data', size: 1024, data: dataChunkData }, // Add actual data
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.format.formatTag).toBe(WAVE_FORMAT_IMA_ADPCM);
      expect(result.format.bitsPerSample).toBe(4);
      expect(result.format.samplesPerBlock).toBe(505);

      // Calculate expected values
      const numBlocks = Math.floor(1024 / 512); // 1024 bytes / 512 block align
      const totalFrames = numBlocks * 505; // 2 blocks * 505 samples/block
      const totalSamples = totalFrames * 1; // 1010 samples * 1 channel

      expect(result.totalSamples).toBe(totalSamples);
    });
  });

  describe('Edge case: Zero/unusual values (hand-crafted)', () => {
    it('handles zero sample rate', () => {
      const fmtData = new Uint8Array(16);
      const view = new DataView(fmtData.buffer);
      view.setUint16(0, WAVE_FORMAT_PCM, true);
      view.setUint16(2, 2, true);
      view.setUint32(4, 0, true); // Sample rate = 0
      view.setUint16(14, 16, true);

      const buffer = createTestBuffer({
        chunks: [
          { id: 'fmt ', size: 16, data: fmtData },
          { id: 'data', size: 100 },
        ],
      });

      const result = parseWavHeader(buffer);
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

      expect(() => parseWavHeader(buffer)).not.toThrow();
    });
  });

  describe('Edge case: Big-endian (RIFX) format', () => {
    it('parses big-endian header', () => {
      const buffer = createTestBuffer({
        endianness: 'BE',
        chunks: [
          { id: 'fmt ', size: 16, data: new Uint8Array(16) },
          {
            id: 'data',
            size: 4,
            data: new Uint8Array([1, 2, 3, 4]),
          },
        ],
      });

      const result = parseWavHeader(buffer);
      expect(result.format).toBeDefined();
      expect(result.dataBytes).toBe(4);
    });
  });

  it('allows data chunk before fmt ', () => {
    const buffer = createTestBuffer({
      chunks: [
        { id: 'data', size: 4, data: new Uint8Array([1, 2, 3, 4]) },
        { id: 'fmt ', size: 16, data: new Uint8Array(16) },
      ],
    });

    const result = parseWavHeader(buffer);
    expect(result.format).toBeDefined();
    expect(result.dataChunks.length).toBe(1);
  });
});
