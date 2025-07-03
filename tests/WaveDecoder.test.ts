import { beforeAll, beforeEach, describe, expect, it, test } from 'vitest';
import { type DecodedWaveAudio, DecoderState,  WaveDecoder } from '../src';
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

describe('WaveDecoder', () => {
  let decoder: WaveDecoder;

  beforeEach(() => {
    decoder = new WaveDecoder();
  });

  test.each(Object.entries(fixtureProperties))(
    'should correctly decode %s in a single call',
    (fixtureName, expected) => {
      const audioData = loadedFixtures.get(fixtureName);
      if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

      const result: DecodedWaveAudio = decoder.decode(audioData);
      const format = decoder.info.format;

      expect(result.errors, `File ${fixtureName} should have no errors`).toEqual([]);
      expect(format.format, `File: ${fixtureName} - formatTag`).toBe(expected.formatTag);
      expect(format.numChannels, `File: ${fixtureName} - channels`).toBe(expected.channels);
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
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

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
      const frameResult = decoder.decodeFrames(frameData);
      expect(frameResult.errors).toEqual([]);
      totalSamplesDecoded += frameResult.samplesDecoded;
    }

    expect(totalSamplesDecoded).toBe(expected.samplesPerChannel);
  });

  it('should correctly decode a single frame with decodeFrame', () => {
    const fixtureName = 'pcm_d16_le_stereo.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const dataChunkStart = findStringInUint8Array(audioData, 'data');
    const headerEndOffset = dataChunkStart + 8;
    const header = audioData.subarray(0, headerEndOffset);
    const body = audioData.subarray(headerEndOffset);

    expect(decoder.decodeFrame(body.subarray(0, 4)), 'Should return null when in UNINIT state').toBeNull();

    decoder.decode(header);
    expect(decoder.info.state).toBe(DecoderState.DECODING);
    const { blockAlign, numChannels } = decoder.info.format;

    const bytesDecodedBefore = decoder.info.decodedBytes;
    expect(bytesDecodedBefore, 'decodedBytes should be 0 after header is processed').toBe(0);

    const firstFrame = body.subarray(0, blockAlign);
    const result = decoder.decodeFrame(firstFrame);

    const bytesDecodedAfter = decoder.info.decodedBytes;
    expect(bytesDecodedAfter, 'decodeFrame should not modify decodedBytes').toBe(bytesDecodedBefore);

    expect(result, 'Result should not be null for a valid frame').not.toBeNull();
    expect(result).toBeInstanceOf(Float32Array);
    expect(result!.length, 'Output array length should match channel count').toBe(numChannels);

    const batchResult = decoder.decodeFrames(firstFrame);
    const expectedLeftSample = batchResult.channelData[0]![0]!;
    const expectedRightSample = batchResult.channelData[1]![0]!;

    expect(result![0]).toBeCloseTo(expectedLeftSample);
    expect(result![1]).toBeCloseTo(expectedRightSample);

    const badFrame = body.subarray(0, blockAlign - 1);
    expect(decoder.decodeFrame(badFrame), 'Should return null for incorrectly sized frames').toBeNull();
  });

  it('should handle flushing incomplete frames', async () => {
    const fixtureName = 'pcm_d16_le_stereo.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const partialAudioData = audioData.subarray(0, audioData.length - 1);
    decoder.decode(partialAudioData);

    // @ts-expect-error access internal buffer
    const internalBuffer = decoder.ringBuffer;
    expect(internalBuffer.available).toBe(3);

    const flushResult = decoder.flush();

    expect(flushResult).toBeDefined();
    expect(internalBuffer.available).toBe(0);
    expect(decoder.info.state).toBe(DecoderState.ENDED);
    expect(flushResult.errors[0]?.message).toBe('Discarded 3 bytes of incomplete final block.');
  });

  it('should free resources and end the decoder', () => {
    const fixtureName = 'pcm_d8_le_mono.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

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
