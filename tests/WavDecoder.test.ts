import { beforeAll, beforeEach, describe, expect, it, test } from 'vitest';
import { type DecodedWavAudio, DecoderState, WavDecoder } from '../src';
import { fixtureProperties } from './fixtures';
import { findStringInUint8Array, loadFixture } from './fixtures/helpers';

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
  const fixtureNames = Object.keys(fixtureProperties);
  const audioDataArray = await Promise.all(fixtureNames.map((name) => loadFixture(name)));

  fixtureNames.forEach((name, index) => {
    loadedFixtures.set(name, audioDataArray[index]!);
  });
});

describe('WavDecoder', () => {
  let decoder: WavDecoder;

  beforeEach(() => {
    decoder = new WavDecoder();
  });

  test.each(Object.entries(fixtureProperties))(
    'should correctly decode %s in a single call',
    (fixtureName, expected) => {
      const audioData = loadedFixtures.get(fixtureName);
      if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

      const result: DecodedWavAudio = decoder.decode(audioData);
      const format = decoder.info.format;

      expect(result.errors).toEqual([]);
      expect(format.formatTag).toBe(expected.formatTag);
      expect(format.channels).toBe(expected.channels);
      expect(format.sampleRate).toBe(expected.sampleRate);
      expect(format.bitDepth).toBe(expected.bitDepth);
      expect(result.channelData.length).toBe(expected.channels);

      for (let i = 0; i < result.channelData.length; i++) {
        expect(result.channelData[i]?.length).toBe(expected.samplesPerChannel);
      }
    },
  );

  it('should handle NaN/Inf values in exotic_float32_nan_inf.wav', () => {
    const fixtureName = 'exotic_float32_nan_inf.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const result = decoder.decode(audioData);
    expect(result.errors).toEqual([]);

    const hasNaN = result.channelData[0]?.some(Number.isNaN);
    expect(hasNaN).toBe(true);

    const hasInf = result.channelData[0]?.some(
      (sample) => !Number.isNaN(sample) && !Number.isFinite(sample),
    );
    expect(hasInf).toBe(false);
  });

  it('should decode completely silent files correctly', () => {
    const fixtureName = 'exotic_silent_pcm16_mono.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const result = decoder.decode(audioData);
    expect(result.errors).toEqual([]);

    // Optimized: Single bulk check per channel
    result.channelData.forEach((channel) => {
      const isSilent = channel.every((sample) => sample === 0);
      expect(isSilent).toBe(true);
    });
  });

  it('should handle clipped silent files', () => {
    const fixtureName = 'exotic_alt_clipped_silent_stereo.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const result = decoder.decode(audioData);
    expect(result.errors).toEqual([]);

    result.channelData.forEach((channel) => {
      const invalidSamples = channel
        .map((s) => Math.round(s))
        .filter((s) => s !== -1 && s !== 0 && s !== 1);

      expect(invalidSamples).toEqual(new Float32Array(0));
    });
  });

  it('should handle short files with limited samples', () => {
    const fixtureName = 'exotic_short_pcm16_80samples.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const result = decoder.decode(audioData);
    expect(result.errors).toEqual([]);
    expect(result.channelData[0]?.length).toBe(80);
  });

  it('should correctly decode multi-channel files', () => {
    const multiChannelFixtures = [
      'sweep_pcm_24bit_le_8ch.wav',
      'sine_pcm_24bit_le_8ch.wav',
      'sine_float_32bit_le_8ch.wav',
    ];

    multiChannelFixtures.forEach((fixtureName) => {
      decoder = new WavDecoder();
      const audioData = loadedFixtures.get(fixtureName);
      if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

      const result = decoder.decode(audioData);
      expect(result.errors).toEqual([]);
      expect(result.channelData.length).toBe(8);
    });
  });

  it('should handle clipped PCM files', () => {
    const clippedFixtures = [
      'exotic_clipped_pcm16_mono.wav',
      'exotic_alt_clipped_silent_stereo.wav',
    ];

    clippedFixtures.forEach((fixtureName) => {
      decoder = new WavDecoder();
      const audioData = loadedFixtures.get(fixtureName);
      if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

      const result = decoder.decode(audioData);
      expect(result.errors).toEqual([]);

      result.channelData.forEach((channel) => {
        const outOfRange = channel.filter((s) => s < -1 || s > 1);
        expect(outOfRange).toEqual(new Float32Array(0));
      });
    });
  });

  it('should handle flushing incomplete frames for exotic files', () => {
    const fixtureName = 'exotic_short_pcm16_80samples.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    const partialAudioData = audioData.subarray(0, audioData.length - 1);
    decoder.decode(partialAudioData);

    const flushResult = decoder.flush();

    expect(flushResult).toBeDefined();
    expect(decoder.info.state).toBe(DecoderState.ENDED);
    expect(flushResult.errors[0]?.message).toMatch(/Discarded \d+ bytes of incomplete final block/);
  });

  it('should free resources and end the decoder', () => {
    const fixtureName = 'sine_pcm_8bit_le_mono.wav';
    const audioData = loadedFixtures.get(fixtureName);
    if (!audioData) throw new Error(`Fixture "${fixtureName}" not found.`);

    decoder.decode(audioData.subarray(0, 128));
    expect(decoder.info.state).toBe(DecoderState.DECODING);

    decoder.free();

    expect(decoder.info.state).toBe(DecoderState.ENDED);
  });

  it('should enter an error state for a file with an invalid RIFF identifier', () => {
    const fixtureName = 'sine_pcm_8bit_le_mono.wav';
    const audioData = loadedFixtures.get(fixtureName)!.slice();
    audioData[1] = 0x4f;

    const result = decoder.decode(audioData);

    expect(result.samplesDecoded).toBe(0);
    expect(decoder.info.state).toBe(DecoderState.ERROR);
    expect(decoder.info.errors[0]?.message).toBe('Invalid WAV file');
  });
});
