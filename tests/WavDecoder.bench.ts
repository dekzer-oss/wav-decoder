// tests/WavDecoder.bench.ts
import { beforeAll, bench, describe } from 'vitest';
import { DecoderState, WavDecoder } from '../src';
import { fixtureProperties } from './fixtures';
import { loadFixture } from './fixtures/helpers';

// -------------------------------
// Fixture loading (once)
// -------------------------------
const fixtureData = new Map<string, Uint8Array>();

beforeAll(async () => {
  const names = Object.keys(fixtureProperties);
  const blobs = await Promise.all(names.map(loadFixture));
  names.forEach((n, i) => {
    const buf = blobs[i];
    if (!buf) throw new Error(`Fixture missing: ${n}`);
    fixtureData.set(n, buf);
  });
});

// -------------------------------
// Helpers
// -------------------------------
let globalChecksum = 0;

function simpleChecksum(channelData?: Float32Array[]): number {
  if (!channelData || channelData.length === 0) return 0;
  let sum = 0;
  for (const ch of channelData) {
    const n = Math.min(256, ch.length);
    for (let i = 0; i < n; i++) sum += ch[i]!;
  }
  return sum;
}

function readU32LE(a: Uint8Array, off: number): number {
  return (a[off]! | (a[off + 1]! << 8) | (a[off + 2]! << 16) | (a[off + 3]! << 24)) >>> 0;
}

function readTag(a: Uint8Array, off: number): string {
  return String.fromCharCode(a[off]!, a[off + 1]!, a[off + 2]!, a[off + 3]!);
}

/**
 * Split a valid RIFF/WAVE into header (up to and including 'data' + size) and body (raw PCM/ADPCM/etc).
 * This is robust to extra chunks and alignment padding.
 */
function splitHeaderBody(wav: Uint8Array): { header: Uint8Array; body: Uint8Array } {
  if (wav.length < 12) throw new Error('Invalid WAV: too short');
  const riff = readTag(wav, 0);
  const wave = readTag(wav, 8);
  if (riff !== 'RIFF' && riff !== 'RIFX') throw new Error('Invalid WAV: missing RIFF');
  if (wave !== 'WAVE') throw new Error('Invalid WAV: missing WAVE');

  let off = 12;
  while (off + 8 <= wav.length) {
    const id = readTag(wav, off);
    const sz = readU32LE(wav, off + 4);
    const dataStart = off + 8;
    const next = dataStart + sz + (sz & 1); // chunks are word-aligned

    if (id === 'data') {
      // end just before payload
      const header = wav.slice(0, dataStart + 4); // include 'data'
      const sizeField = wav.slice(off + 4, off + 8); // 4-byte size
      const fullHeader = new Uint8Array(header.length + 4);
      fullHeader.set(header, 0);
      fullHeader.set(sizeField, header.length);
      const body = wav.slice(dataStart);
      return { header: fullHeader, body };
    }
    off = next;
  }
  throw new Error('WAV: data chunk not found');
}

/**
 * Initialize decoder with header and compute a safe chunk size.
 */
function initBlockDecoder(header: Uint8Array) {
  const dec = new WavDecoder();
  const initRes = dec.decode(header);
  if (dec.info.state !== DecoderState.DECODING) {
    dec.free();
    throw new Error('Decoder init failed from header');
  }
  const fmt = dec.info.format;
  const blockSize =
    (fmt?.blockSize && fmt.blockSize > 0 ? fmt.blockSize : (fmt?.channels ?? 0) * ((fmt?.bitDepth ?? 0) / 8)) | 0;

  if (!Number.isFinite(blockSize) || blockSize <= 0) {
    dec.free();
    throw new Error('Invalid block size');
  }

  const chunkSize = blockSize * 512;
  return { dec, chunkSize };
}

describe('WavDecoder full decode() performance', () => {
  const benchOptions = {
    warmupIterations: 100,
    iterations: 1000,
    time: 5_000,
  } as const;

  const testFiles = ['sine_alaw_8bit_le_mono.wav', 'sine_pcm_16bit_le_stereo.wav', 'sine_pcm_24bit_be_stereo.wav'];

  for (const file of testFiles) {
    bench(
      `Full decode: ${file}`,
      () => {
        const data = fixtureData.get(file);
        if (!data) throw new Error(`Fixture not loaded: ${file}`);
        const decoder = new WavDecoder();
        const result = decoder.decode(data);
        globalChecksum += simpleChecksum(result.channelData);
        decoder.free();
      },
      benchOptions
    );
  }
});

describe('WavDecoder block processing performance', () => {
  const benchOptions = {
    warmupIterations: 50,
    iterations: 500,
    time: 10_000,
  } as const;

  const file = 'sine_pcm_16bit_le_stereo.wav';

  bench(
    'Block processing: decodeFrames()',
    () => {
      const data = fixtureData.get(file);
      if (!data) throw new Error(`Fixture not loaded: ${file}`);
      const { header, body } = splitHeaderBody(data);

      const { dec, chunkSize } = initBlockDecoder(header);
      let checksum = 0;

      for (let off = 0; off < body.length; off += chunkSize) {
        const chunk = body.slice(off, off + chunkSize);
        const res = dec.decodeFrames(chunk);
        checksum += simpleChecksum(res.channelData);
      }

      // flush
      const finalRes = dec.decodeFrames(new Uint8Array(0));
      checksum += simpleChecksum(finalRes.channelData);

      globalChecksum += checksum;
      dec.free();
    },
    benchOptions
  );

  bench(
    'Block processing: decode()',
    () => {
      const data = fixtureData.get(file);
      if (!data) throw new Error(`Fixture not loaded: ${file}`);
      const { header, body } = splitHeaderBody(data);

      const { dec, chunkSize } = initBlockDecoder(header);
      let checksum = 0;

      for (let off = 0; off < body.length; off += chunkSize) {
        const chunk = body.slice(off, off + chunkSize);
        const res = dec.decode(chunk);
        checksum += simpleChecksum(res.channelData);
      }

      const finalRes = dec.decode(new Uint8Array(0));
      checksum += simpleChecksum(finalRes.channelData);

      globalChecksum += checksum;
      dec.free();
    },
    benchOptions
  );
});
