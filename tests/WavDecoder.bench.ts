import { beforeAll, afterAll, bench, type BenchOptions, describe } from 'vitest';
import { DecoderState, WavDecoder } from '../src';
import { type FixtureKey, fixtureKeys, fixtureProperties } from './fixtures';
import { loadFixture } from './fixtures/helpers';

function inflateWavBody(src: Uint8Array, times = 32): Uint8Array {
  const dataPos = src.findIndex(
    (b, i) => i + 3 < src.length && src[i] === 0x64 && src[i + 1] === 0x61 && src[i + 2] === 0x74 && src[i + 3] === 0x61
  );
  if (dataPos < 0) throw new Error('data chunk not found');
  const sizeView = new DataView(src.buffer, src.byteOffset + dataPos + 4, 4);
  const bodySize = sizeView.getUint32(0, true);
  const headerEnd = dataPos + 8;
  const header = new Uint8Array(src.subarray(0, headerEnd));
  const body = src.subarray(headerEnd, headerEnd + bodySize);

  const bigBody = new Uint8Array(body.length * times);
  for (let i = 0; i < times; i++) bigBody.set(body, i * body.length);

  const riffSize = headerEnd - 8 + bigBody.length;
  const dataSizeLE = body.length * times;
  new DataView(header.buffer, header.byteOffset + 4, 4).setUint32(0, riffSize, true);
  new DataView(header.buffer, header.byteOffset + dataPos + 4, 4).setUint32(0, dataSizeLE, true);

  const out = new Uint8Array(header.length + bigBody.length);
  out.set(header, 0);
  out.set(bigBody, header.length);
  return out;
}

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  const fixtureNames = Object.keys(fixtureProperties);
  const audioDataArray = await Promise.all(fixtureNames.map(loadFixture));
  fixtureNames.forEach((name, idx) => {
    loadedFixtures.set(name, audioDataArray[idx]!);
  });
});

const benchOptions: BenchOptions = {
  warmupIterations: 10,
  iterations: 1000,
  time: 3_000,
};

describe('WavDecoder full decode() performance', () => {
  const decoder = new WavDecoder();
  afterAll(() => decoder.free());
  (
    [
      'sine_ulaw_8bit_le_stereo.wav',
      'sine_alaw_8bit_le_mono.wav',
      'sine_pcm_16bit_le_stereo.wav',
      'sine_pcm_24bit_be_stereo.wav',
      'sine_pcm_24bit_le_mono.wav',
      'sine_pcm_16bit_be_mono.wav',
      'sine_float_32bit_le_8ch.wav',
      'sine_float_32bit_be_stereo.wav',
      'sine_float_64bit_le_stereo.wav',
    ] as FixtureKey[]
  ).forEach((file) => {
    bench(
      `${file} - decode (reused decoder)`,
      () => {
        const data = loadedFixtures.get(file)!;
        decoder.reset();
        decoder.decode(data);
      },
      benchOptions
    );
  });
});

describe('WavDecoder API comparison under looping conditions', () => {
  const setupDecoderWithBody = (fixtureName: string) => {
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
  };

  bench(
    'block-by-block (using decode)',
    () => {
      const { decoder, body, format } = setupDecoderWithBody('sine_pcm_16bit_le_stereo.wav');
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

describe('WavDecoder full file macrobench', () => {
  const decoder = new WavDecoder();
  afterAll(() => decoder.free());

  fixtureKeys.forEach((file) => {
    let bigFile: Uint8Array;

    beforeAll(() => {
      const src = loadedFixtures.get(file)!;
      bigFile = inflateWavBody(src, 32);
    });

    bench(
      `${file} - reset then decode on big file with reused decoder`,
      () => {
        decoder.reset();
        decoder.decode(bigFile);
      },
      benchOptions
    );
  });
});
