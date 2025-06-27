import { beforeAll, bench, describe } from 'vitest';
import { State, WavDecoder } from '../src';
import { fixtureProperties } from './utils/fixtures';
import { loadFixture } from './utils/helpers';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  const fixtureNames = Object.keys(fixtureProperties);
  const audioDataArray = await Promise.all(fixtureNames.map(loadFixture));

  fixtureNames.forEach((name, index) => {
    loadedFixtures.set(name, audioDataArray[index]!);
  });
});

describe('WavDecoder full decode() performance', () => {
  bench('8bit_mono.wav - decode', () => {
    const data = loadedFixtures.get('8bit_mono.wav')!;
    const decoder = new WavDecoder();
    decoder.decode(data);
    decoder.free();
  });

  bench('pcm_d16_le_stereo.wav - decode', () => {
    const data = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WavDecoder();
    decoder.decode(data);
    decoder.free();
  });

  bench('pcm_d24_be_stereo.wav - decode', () => {
    const data = loadedFixtures.get('pcm_d24_be_stereo.wav')!;
    const decoder = new WavDecoder();
    decoder.decode(data);
    decoder.free();
  });

  // Add more benches here statically for each fixture you care about.
});

describe('WavDecoder API comparison under looping conditions', () => {

  // Benchmark 1: Using the specialized 'decodeAligned' method in a loop.
  bench('block-by-block (using decodeAligned)', () => {
    // This setup is repeated inside each bench to ensure fixtures are loaded.
    const fileData = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WavDecoder();

    // Initialize the decoder
    const header = fileData.subarray(0, 100);
    decoder.decode(header);

    if (decoder.info.state !== State.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }

    const headerBytesProcessed = decoder.info.bytesDecoded;
    const body = fileData.subarray(headerBytesProcessed);
    const { blockAlign } = decoder.info.format;
    const chunkSize = blockAlign * 512;

    // This is the "hot loop" being measured
    for (let i = 0; i < body.length; i += chunkSize) {
      const chunk = body.subarray(i, i + chunkSize);
      if (chunk.length % blockAlign === 0) {
        decoder.decodeAligned(chunk);
      }
    }

    decoder.free();
  });


  // Benchmark 2: Using the standard 'decode' method in the same loop.
  bench('block-by-block (using decode)', () => {
    // The setup is identical to the one above.
    const fileData = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WavDecoder();

    const header = fileData.subarray(0, 100);
    decoder.decode(header);

    if (decoder.info.state !== State.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }

    const headerBytesProcessed = decoder.info.bytesDecoded;
    const body = fileData.subarray(headerBytesProcessed);
    const { blockAlign } = decoder.info.format;
    const chunkSize = blockAlign * 512;

    // The hot loop is the same, but calls `decode` instead of `decodeAligned`
    for (let i = 0; i < body.length; i += chunkSize) {
      const chunk = body.subarray(i, i + chunkSize);
      // We don't need the alignment check for the robust `decode` method
      if (chunk.length > 0) {
        decoder.decode(chunk);
      }
    }

    decoder.free();
  });
});
