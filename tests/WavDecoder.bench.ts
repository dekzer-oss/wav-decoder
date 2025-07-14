import { beforeAll, bench, type BenchOptions, describe } from 'vitest';
import { DecoderState, WavDecoder } from '../src';
import { fixtureProperties } from './fixtures';
import { loadFixture } from './fixtures/helpers.ts';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  const fixtureNames = Object.keys(fixtureProperties);
  const audioDataArray = await Promise.all(fixtureNames.map(loadFixture));

  fixtureNames.forEach((name, index) => {
    loadedFixtures.set(name, audioDataArray[index]!);
  });
});

const benchOptions: BenchOptions = {
  warmupIterations: 20,
  time: 1_000,
};

describe('WavDecoder full decode() performance', () => {
  bench(
    'sine_alaw_8bit_le_mono.wav - decode',
    () => {
      const data = loadedFixtures.get('sine_alaw_8bit_le_mono.wav');
      if (!data) throw new Error('Fixture not found: sine_alaw_8bit_le_mono.wav');
      const decoder = new WavDecoder();
      decoder.decode(data);
      decoder.free();
    },
    benchOptions
  );

  bench(
    'sine_pcm_16bit_le_stereo.wav - decode',
    () => {
      const data = loadedFixtures.get('sine_pcm_16bit_le_stereo.wav');
      if (!data) throw new Error('Fixture not found: sine_pcm_16bit_le_stereo.wav');
      const decoder = new WavDecoder();
      decoder.decode(data);
      decoder.free();
    },
    benchOptions
  );

  bench(
    'sine_pcm_24bit_be_stereo.wav - decode',
    () => {
      const data = loadedFixtures.get('sine_pcm_24bit_be_stereo.wav');
      if (!data) throw new Error('Fixture not found: sine_pcm_24bit_be_stereo.wav');
      const decoder = new WavDecoder();
      decoder.decode(data);
      decoder.free();
    },
    benchOptions
  );
});

describe('WavDecoder API comparison under looping conditions', () => {
  const setupDecoderWithBody = (fixtureName: string) => {
    const fileData = loadedFixtures.get(fixtureName);
    if (!fileData) throw new Error(`Fixture not found: ${fixtureName}`);
    const decoder = new WavDecoder();

    const dataChunkStart = fileData.findIndex(
      (byte, i) =>
        i + 3 < fileData.length &&
        String.fromCharCode(byte) === 'd' &&
        String.fromCharCode(fileData[i + 1]!) === 'a' &&
        String.fromCharCode(fileData[i + 2]!) === 't' &&
        String.fromCharCode(fileData[i + 3]!) === 'a'
    );
    const headerEndOffset = dataChunkStart + 8;
    const header = fileData.subarray(0, headerEndOffset);
    const body = fileData.subarray(headerEndOffset);

    decoder.decode(header);
    if (decoder.info.state !== DecoderState.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }
    return { decoder, body, format: decoder.info.format };
  };

  bench(
    'block-by-block (using decodeFrames)',
    () => {
      const { decoder, body, format } = setupDecoderWithBody('sine_pcm_16bit_le_stereo.wav');
      const { blockSize } = format;
      const chunkSize = blockSize * 512;

      for (let i = 0; i < body.length; i += chunkSize) {
        const chunk = body.subarray(i, i + chunkSize);
        if (chunk.length % blockSize === 0) {
          decoder.decodeFrames(chunk);
        }
      }

      decoder.free();
    },
    benchOptions
  );

  bench(
    'block-by-block (using decode)',
    () => {
      const { decoder, body, format } = setupDecoderWithBody('sine_pcm_16bit_le_stereo.wav');
      const { blockSize } = format;
      const chunkSize = blockSize * 512;

      for (let i = 0; i < body.length; i += chunkSize) {
        const chunk = body.subarray(i, i + chunkSize);
        if (chunk.length > 0) {
          decoder.decode(chunk);
        }
      }

      decoder.free();
    },
    benchOptions
  );
});
