import { beforeAll, bench, describe } from 'vitest';
import { DecoderState, WavDecoder } from '../src';
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
});

describe('WavDecoder API comparison under looping conditions', () => {
  bench('block-by-block (using decodeAligned)', () => {
    const fileData = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WavDecoder();

    const header = fileData.subarray(0, 100);
    decoder.decode(header);

    if (decoder.info.state !== DecoderState.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }

    const headerBytesProcessed = decoder.info.bytesDecoded;
    const body = fileData.subarray(headerBytesProcessed);
    const { blockAlign } = decoder.info.format;
    const chunkSize = blockAlign * 512;

    for (let i = 0; i < body.length; i += chunkSize) {
      const chunk = body.subarray(i, i + chunkSize);
      if (chunk.length % blockAlign === 0) {
        decoder.decodeAligned(chunk);
      }
    }

    decoder.free();
  });

  bench('block-by-block (using decode)', () => {
    const fileData = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WavDecoder();

    const header = fileData.subarray(0, 100);
    decoder.decode(header);

    if (decoder.info.state !== DecoderState.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }

    const headerBytesProcessed = decoder.info.bytesDecoded;
    const body = fileData.subarray(headerBytesProcessed);
    const { blockAlign } = decoder.info.format;
    const chunkSize = blockAlign * 512;

    for (let i = 0; i < body.length; i += chunkSize) {
      const chunk = body.subarray(i, i + chunkSize);
      if (chunk.length > 0) {
        decoder.decode(chunk);
      }
    }

    decoder.free();
  });
});
