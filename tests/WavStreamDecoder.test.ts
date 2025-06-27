import { beforeAll, beforeEach, describe, expect, it, test } from 'vitest';
import { type WavDecodedAudio, DecoderState, type WaveFormat, WavStreamDecoder } from '../src';
import { fixtureProperties } from './utils/fixtures';
import { findStringInUint8Array, loadFixture } from './utils/helpers';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  const fixtureNames = Object.keys(fixtureProperties);
  const loadPromises = fixtureNames.map((name) => loadFixture(name));
  const audioDataArray = await Promise.all(loadPromises);

  fixtureNames.forEach((name, index) => {
    loadedFixtures.set(name, audioDataArray[index]!);
  });
});

describe('WavStreamDecoder', () => {
  let decoder: WavStreamDecoder;

  beforeEach(() => {
    decoder = new WavStreamDecoder();
  });

  test.each(Object.entries(fixtureProperties))(
    'should correctly decode %s in a single call',
    (fixtureName, expected) => {
      const audioData = loadedFixtures.get(fixtureName)!;
      const result: WavDecodedAudio = decoder.decode(audioData);
      const format = decoder.info.format as WaveFormat;

      expect(result.errors, `File ${fixtureName} should have no errors`).toEqual([]);
      expect(format.formatTag, `File: ${fixtureName} - formatTag`).toBe(expected.formatTag);
      expect(format.channels, `File: ${fixtureName} - channels`).toBe(expected.channels);
      expect(format.sampleRate, `File: ${fixtureName} - sampleRate`).toBe(expected.sampleRate);
      expect(format.bitsPerSample, `File: ${fixtureName} - bitDepth`).toBe(expected.bitDepth);
      expect(result.channelData.length, `File: ${fixtureName} - channelData.length`).toBe(expected.channels);

      for (let i = 0; i < result.channelData.length; i++) {
        expect(result.channelData[i]?.length, `File: ${fixtureName} - channel[${i}].length`).toBe(
          expected.samplesPerChannel
        );
      }
    }
  );

  test.each(Object.entries(fixtureProperties))('should correctly decode %s frame by frame', (fixtureName, expected) => {
    const audioData = loadedFixtures.get(fixtureName)!;
    const dataChunkStart = findStringInUint8Array(audioData, 'data');
    expect(dataChunkStart, `File ${fixtureName} must contain a 'data' chunk`).toBeGreaterThan(-1);

    const headerEndOffset = dataChunkStart + 8;
    const header = audioData.subarray(0, headerEndOffset);
    const body = audioData.subarray(headerEndOffset);

    decoder.decode(header);
    expect(decoder.info.state).toBe(DecoderState.DECODING);

    const { blockAlign } = decoder.info.format;
    expect(blockAlign, `File ${fixtureName} must have a valid blockAlign`).toBeGreaterThan(0);

    let totalSamplesDecoded = 0;
    const chunkSize = blockAlign * 512;

    for (let offset = 0; offset < body.length; offset += chunkSize) {
      const chunk = body.subarray(offset, offset + chunkSize);
      const framesInChunk = Math.floor(chunk.length / blockAlign);
      if (framesInChunk === 0) continue;

      const frameData = chunk.subarray(0, framesInChunk * blockAlign);
      const frameResult = decoder.decodeAligned(frameData);
      expect(frameResult.errors).toEqual([]);
      totalSamplesDecoded += frameResult.samplesDecoded;
    }

    expect(totalSamplesDecoded).toBe(expected.samplesPerChannel);
  });

  it('should handle flushing incomplete frames', async () => {
    const audioData = loadedFixtures.get('pcm_d16_le_stereo.wav')!;
    const partialAudioData = audioData.subarray(0, audioData.length - 1);
    decoder.decode(partialAudioData);

    // @ts-expect-error - Call internal private method
    const internalBuffer = decoder.audioBuffer;
    expect(internalBuffer.available).toBe(3);

    const flushResult = await decoder.flush();

    expect(flushResult).toBeNull();
    expect(internalBuffer.available).toBe(0);
    expect(decoder.info.state).toBe(DecoderState.ENDED);
    expect(decoder.info.errors[0]?.message).toContain('Discarded 3 bytes');
  });

  it('should free resources and end the decoder', () => {
    const audioData = loadedFixtures.get('pcm_d8_le_mono.wav')!;
    decoder.decode(audioData.subarray(0, 128));
    expect(decoder.info.state).toBe(DecoderState.DECODING);

    decoder.free();

    expect(decoder.info.state).toBe(DecoderState.ENDED);
    expect(decoder.info.format).toEqual({});
  });

  it('should enter an error state for a file with an invalid RIFF identifier', () => {
    const audioData = loadedFixtures.get('pcm_d8_le_mono.wav')!.slice();
    audioData[1] = 0x4f;

    const result = decoder.decode(audioData);

    expect(result.samplesDecoded).toBe(0);
    expect(decoder.info.state).toBe(DecoderState.ERROR);
    expect(decoder.info.errors[0]?.message).toBe('Invalid WAV file');
  });
});
