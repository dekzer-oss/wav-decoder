import { beforeAll, afterAll, bench, type BenchOptions, describe, beforeEach } from 'vitest';
import { WavDecoder } from '../src';
import { type FixtureKey, fixtureKeys } from './fixtures';
import { loadFixture } from './fixtures/helpers';
import { describeFormat, inflateWavBody } from './fixtures/utils';
import { DecoderState } from '../src/core/StateMachine';

const loadedFixtures = new Map<FixtureKey, Uint8Array>();

beforeAll(async () => {
  const audioDataArray = await Promise.all(fixtureKeys.map(loadFixture));
  fixtureKeys.forEach((name, idx) => {
    loadedFixtures.set(name, audioDataArray[idx]!);
  });
});

const benchOptions: BenchOptions = {
  warmupIterations: 10,
  iterations: 750,
  time: 2_000,
};

describe('WavDecoder | Single-pass decode (decoder reuse)', () => {
  const decoder = new WavDecoder();
  afterAll(() => decoder.free());
  (
    [
      'sine_alaw_8bit_le_mono.wav',
      'sine_ulaw_8bit_le_stereo.wav',
      'sine_pcm_16bit_be_mono.wav',
      'sine_pcm_16bit_le_stereo.wav',
      'sine_pcm_24bit_le_mono.wav',
      'sine_pcm_24bit_be_stereo.wav',
      'sine_float_32bit_le_mono.wav',
      'sine_float_32bit_be_stereo.wav',
      'sine_float_32bit_le_8ch.wav',
      'sine_float_64bit_le_stereo.wav',
    ] as FixtureKey[]
  ).forEach((file) => {
    bench(
      `Decode | ${describeFormat(file)} | Single-pass, Decoder Reuse`,
      () => {
        const data = loadedFixtures.get(file)!;
        decoder.decode(data);
      },
      benchOptions
    );
  });
  beforeEach(() => {
    decoder.reset();
  });
});

describe('WavDecoder | Block streaming decode (new decoder per bench)', () => {
  function setupDecoderWithBody(fixtureName: FixtureKey) {
    const fileData = loadedFixtures.get(fixtureName);
    if (!fileData) throw new Error(`Fixture not found: ${fixtureName}`);

    const decoder = new WavDecoder();

    const dataChunkStart = fileData.findIndex(
      (_byte, i) =>
        i + 3 < fileData.length &&
        fileData[i] === 0x64 &&
        fileData[i + 1] === 0x61 &&
        fileData[i + 2] === 0x74 &&
        fileData[i + 3] === 0x61
    );
    const headerEnd = dataChunkStart + 8;

    decoder.decode(fileData.subarray(0, headerEnd));
    if (decoder.info.state !== DecoderState.DECODING) {
      throw new Error('Decoder failed to initialize.');
    }

    return {
      decoder,
      body: fileData.subarray(headerEnd),
      format: decoder.info.format,
    };
  }

  (['sine_pcm_16bit_le_stereo.wav'] as FixtureKey[]).forEach((file) => {
    bench(
      `Streamed Decode | ${describeFormat(file)} | Block-by-block, New Decoder`,
      () => {
        const { decoder, body, format } = setupDecoderWithBody(file);
        const chunkSize = format.blockAlign * 512;
        for (let i = 0; i < body.length; i += chunkSize) {
          const chunk = body.subarray(i, i + chunkSize);
          decoder.decode(chunk);
        }
        decoder.free();
      },
      benchOptions
    );
  });
});

describe('WavDecoder | Macro decode (big file, reset+decode, decoder reuse)', () => {
  const decoder = new WavDecoder();

  fixtureKeys.forEach((file) => {
    let bigFile: Uint8Array;

    beforeAll(() => {
      const src = loadedFixtures.get(file)!;
      bigFile = inflateWavBody(src, 32);
    });

    beforeEach(() => {
      decoder.reset();
    });

    bench(
      `Macro Decode | ${describeFormat(file)} | 32x Data, Decoder Reset Each Iter`,
      () => {
        decoder.decode(bigFile);
      },
      benchOptions
    );
  });
});
