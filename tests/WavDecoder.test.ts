import { describe, it, expect, beforeAll } from 'vitest';
import { WavDecoder } from '../src/WavDecoder';
import { fixtureKeys, fixtureProperties } from './fixtures';
import { loadFixture } from './fixtures/helpers';
import { DecoderState } from '../src';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  for (const key of fixtureKeys) {
    loadedFixtures.set(key, await loadFixture(key));
  }
});
