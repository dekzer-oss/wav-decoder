import { beforeAll, bench, describe } from 'vitest';
import { DecoderState, WaveDecoder } from '../src';
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

describe('WaveDecoder full decode() performance', () => {
  bench('8bit_mono.wav - decode', () => {
    const data = loadedFixtures.get('8bit_mono.wav')!;
    const decoder = new WaveDecoder();
    decoder.decode(data);
    decoder.free();
  });

  bench('pcm_d16_le_stereo.wav - decode', () => {
    const data = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const decoder = new WaveDecoder();
    decoder.decode(data);
    decoder.free();
  });

  bench('pcm_d24_be_stereo.wav - decode', () => {
    const data = loadedFixtures.get('pcm_d24_be_stereo.wav')!;
    const decoder = new WaveDecoder();
    decoder.decode(data);
    decoder.free();
  });
});

describe('WaveDecoder API comparison under looping conditions', () => {
  const setupDecoderWithBody = (fixtureName: string) => {
    const fileData = loadedFixtures.get(fixtureName)!;
    const decoder = new WaveDecoder();

    const dataChunkStart = fileData.findIndex((byte, i) =>
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

  bench('block-by-block (using decodeFrames)', () => {
    const { decoder, body, format } = setupDecoderWithBody('pcm_d16_le_stereo.wav');
    const { blockAlign } = format;
    const chunkSize = blockAlign * 512;

    for (let i = 0; i < body.length; i += chunkSize) {
      const chunk = body.subarray(i, i + chunkSize);
      if (chunk.length % blockAlign === 0) {
        decoder.decodeFrames(chunk);
      }
    }

    decoder.free();
  });

  bench('block-by-block (using decode)', () => {
    const { decoder, body, format } = setupDecoderWithBody('pcm_d16_le_stereo.wav');
    const { blockAlign } = format;
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
