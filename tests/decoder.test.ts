import {describe, expect, it} from "vitest";
import {State, WavStreamDecoder} from "../src/decoder";
import type {DecodedAudio, WavFormat} from "../src/types";

interface FixtureProperties {
    channels: number;
    sampleRate: number;
    bitDepth: number;
    samplesPerChannel: number;
    formatTag: number;
}

const fixtureProperties: Record<string, FixtureProperties> = {
    "pcm_d8_le_mono.wav": {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 8,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "pcm_d16_le_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 16,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "pcm_d24_le_mono.wav": {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 24,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "pcm_d32_le_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 32,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "pcm_d16_be_mono.wav": {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 16,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "pcm_d24_be_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 24,
        samplesPerChannel: 44100,
        formatTag: 0x0001
    },
    "float_d32_le_mono.wav": {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 32,
        samplesPerChannel: 44100,
        formatTag: 0x0003
    },
    "float_d64_le_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 64,
        samplesPerChannel: 44100,
        formatTag: 0x0003
    },
    "float_d32_be_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 32,
        samplesPerChannel: 44100,
        formatTag: 0x0003
    },
    "alaw_d8_le_mono.wav": {
        channels: 1,
        sampleRate: 44100,
        bitDepth: 8,
        samplesPerChannel: 44100,
        formatTag: 0x0006
    },
    "ulaw_d8_le_stereo.wav": {
        channels: 2,
        sampleRate: 44100,
        bitDepth: 8,
        samplesPerChannel: 44100,
        formatTag: 0x0007
    },
};


function isNodeEnv(): boolean {
    return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

async function loadFixture(fixtureName: string): Promise<Uint8Array> {
    if (isNodeEnv()) {
        const {promises: fs} = await import('fs');
        const path = await import('path');
        const {fileURLToPath} = await import('url');

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const fixturePath = path.resolve(__dirname, "fixtures", fixtureName);
        const fileBuffer = await fs.readFile(fixturePath);
        return new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.length);
    } else {
        const response = await fetch(`/tests/fixtures/${fixtureName}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch fixture: ${fixtureName} - ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }
}

const fixtures = Object.keys(fixtureProperties);

describe("WavStreamDecoder", () => {
    it("should decode various WAV files with correct properties", async () => {
        const decoder = new WavStreamDecoder();

        for (const fixture of fixtures) {
            const audioData = await loadFixture(fixture);
            expect(audioData.length).toBeGreaterThan(0);

            const result: DecodedAudio = decoder.decode(audioData);

            const expected = fixtureProperties[fixture];
            if (!expected) {
                throw new Error(`Missing fixture properties for ${fixture}`);
            }

            const format = decoder.info.format as WavFormat;

            expect(result.errors, `File ${fixture} should have no decoding errors`).toEqual([]);

            // Check format properties parsed by the decoder
            expect(format.formatTag, `File: ${fixture} - formatTag`).toBe(expected.formatTag);
            expect(format.channels, `File: ${fixture} - channels`).toBe(expected.channels);
            expect(format.sampleRate, `File: ${fixture} - sampleRate`).toBe(expected.sampleRate);
            expect(format.bitsPerSample, `File: ${fixture} - bitDepth`).toBe(expected.bitDepth);

            // Check the structure of the decoded audio data
            expect(result.channelData.length, `File: ${fixture} - channelData.length`).toBe(expected.channels);
            expect(result.sampleRate, `File: ${fixture} - result.sampleRate`).toBe(expected.sampleRate);

            // Check that the number of decoded samples is correct for every channel
            for (let i = 0; i < result.channelData.length; i++) {
                expect(result.channelData[i]?.length, `File: ${fixture} - channel[${i}].length`).toBe(expected.samplesPerChannel);
            }

            decoder.reset();
        }
    });


    it("should decode audio frame by frame using decodeFrame", async () => {
        const decoder = new WavStreamDecoder();

        for (const fixture of fixtures) {
            const audioData = await loadFixture(fixture);
            const expected = fixtureProperties[fixture]!;

            const dataChunkStart = findStringInUint8Array(audioData, 'data');
            expect(dataChunkStart, `File ${fixture} must contain a 'data' chunk`).toBeGreaterThan(-1);

            const headerEndOffset = dataChunkStart + 8;
            const header = audioData.subarray(0, headerEndOffset);
            const body = audioData.subarray(headerEndOffset);

            const initialResult = decoder.decode(header);
            expect(initialResult.samplesDecoded).toBe(0);

            expect(decoder.info.state).toBe(State.DECODING);

            const format = decoder.info.format as WavFormat;
            const {blockAlign} = format;
            expect(blockAlign, `File ${fixture} must have a valid blockAlign`).toBeGreaterThan(0);

            let totalSamplesDecoded = 0;
            const chunkSize = blockAlign * 512;

            for (let offset = 0; offset < body.length; offset += chunkSize) {
                const chunk = body.subarray(offset, offset + chunkSize);

                const framesInChunk = Math.floor(chunk.length / blockAlign);
                if (framesInChunk === 0) continue;

                const frameData = chunk.subarray(0, framesInChunk * blockAlign);
                const frameResult = decoder.decodeFrame(frameData);

                expect(frameResult.errors, `File ${fixture} frame decoding should have no errors`).toEqual([]);
                totalSamplesDecoded += frameResult.samplesDecoded;
            }

            expect(totalSamplesDecoded).toBe(expected.samplesPerChannel);

            decoder.reset();
        }
    });


    it("should handle flushing incomplete frames", async () => {
        const decoder = new WavStreamDecoder();
        const audioData = await loadFixture("pcm_d16_le_stereo.wav");

        const partialAudioData = audioData.subarray(0, audioData.length - 1);

        const result = decoder.decode(partialAudioData);

        const internalBuffer = (decoder as any).audioBuffer;
        expect(internalBuffer.available).toBe(3);

        const flushResult = await decoder.flush();

        expect(flushResult).toBeNull();
        expect(internalBuffer.available).toBe(0);
        expect(decoder.info.state).toBe(State.ENDED);
        expect(decoder.info.errors[0]?.message).toContain("Discarded 3 bytes");
    });

    it("should free resources and end the decoder", async () => {
        const decoder = new WavStreamDecoder();
        const audioData = await loadFixture("pcm_d8_le_mono.wav");

        decoder.decode(audioData.subarray(0, 128));
        expect(decoder.info.state).toBe(State.DECODING);
        expect(decoder.info.format.sampleRate).toBe(44100);

        decoder.free();

        expect(decoder.info.state).toBe(State.ENDED);
        expect(decoder.info.format).toEqual({});
        const internalBuffer = (decoder as any).audioBuffer;
        expect(internalBuffer.available).toBe(0);
    });

    it("should enter an error state for a file with an invalid RIFF identifier", async () => {
        const decoder = new WavStreamDecoder();
        const audioData = await loadFixture("pcm_d8_le_mono.wav");

        audioData[1] = 0x4F;

        const result = decoder.decode(audioData);

        expect(result.samplesDecoded).toBe(0);
        expect(decoder.info.state).toBe(State.ERROR);
        expect(decoder.info.errors[0]?.message).toBe("Invalid WAV file");
    });
});

function findStringInUint8Array(haystack: Uint8Array, needle: string): number {
    const needleBytes = new TextEncoder().encode(needle);
    for (let i = 0; i <= haystack.length - needleBytes.length; i++) {
        let found = true;
        for (let j = 0; j < needleBytes.length; j++) {
            if (haystack[i + j] !== needleBytes[j]) {
                found = false;
                break;
            }
        }
        if (found) return i;
    }
    return -1;
}

