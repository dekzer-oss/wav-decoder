import { beforeAll, bench, describe, type BenchOptions } from 'vitest';
import { loadFixture } from './fixtures/helpers';
import { fixtureProperties } from './fixtures';
import { WasmDecoder } from '@/WasmDecoder';

const loadedFixtures = new Map<string, Uint8Array>();
let decoder: WasmDecoder;

const benchOptions: BenchOptions = {
  time: 2500,
  warmupTime: 1000,
};

beforeAll(async () => {
  const names = Object.keys(fixtureProperties);
  const buffers = await Promise.all(names.map(loadFixture));
  names.forEach((n, i) => loadedFixtures.set(n, buffers[i]!));

  decoder = await WasmDecoder.create();
});

describe('WasmDecoder API comparison under looping conditions', () => {
  let body: Uint8Array;
  let header: Uint8Array;
  let chunkSize: number;

  beforeAll(() => {
    const file = loadedFixtures.get('sine_pcm_16bit_le_stereo.wav');
    if (!file) {
      throw new Error('Fixture not loaded: sine_pcm_16bit_le_stereo.wav');
    }
    const dataOffset = file.findIndex(
      (_, i) =>
        file[i] === 0x64 && file[i + 1] === 0x61 && file[i + 2] === 0x74 && file[i + 3] === 0x61,
    );
    const headerEnd = dataOffset + 8;
    header = file.subarray(0, headerEnd);
    body = file.subarray(headerEnd);
    decoder.decode(header);
    chunkSize = decoder.format.blockAlign * 128;
    decoder.reset();
  });

  bench(
    'decode() with looping',
    () => {
      for (let i = 0; i < body.length; i += chunkSize) {
        decoder.decode(body.subarray(i, i + chunkSize));
      }
      decoder.flush();
    },
    benchOptions,
  );

  bench(
    'decode() with looping and reset',
    () => {
      for (let i = 0; i < body.length; i += chunkSize) {
        decoder.decode(body.subarray(i, i + chunkSize));
        decoder.reset();
      }
      decoder.flush();
    },
    benchOptions,
  );
});
