import { describe, it, expect, beforeAll } from 'vitest';
import { WavDecoder, DecoderState } from '../src';
import { fixtureKeys, fixtureProperties } from './fixtures';
import { loadFixture } from './fixtures/helpers';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  for (const key of fixtureKeys) {
    loadedFixtures.set(key, await loadFixture(key));
  }
});

describe('WavDecoder', () => {
  it.each(Object.entries(fixtureProperties))('should decode %s and match expected format', (fixtureName, expected) => {
    const wav = loadedFixtures.get(fixtureName);
    expect(wav, `Fixture "${fixtureName}" not loaded`).toBeDefined();

    const decoder = new WavDecoder();
    const result = decoder.decode(wav!);

    expect(result.errors).toEqual([]);
    expect(decoder.info.state).toBe(DecoderState.DECODING);

    expect(decoder.info.format.channels).toBe(expected.channels);
    expect(decoder.info.format.sampleRate).toBe(expected.sampleRate);
    expect(decoder.info.format.bitsPerSample).toBe(expected.bitDepth);
    expect(decoder.info.format.formatTag).toBe(expected.formatTag);

    expect(result.channelData.length).toBe(expected.channels);
    for (let i = 0; i < result.channelData.length; i++) {
      expect(result.channelData[i]?.length).toBe(expected.samplesPerChannel);
    }
  });
});
