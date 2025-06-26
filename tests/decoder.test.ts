import {describe, expect, it} from "vitest";
import {State, WavStreamDecoder} from "../src/decoder";
import type {DecodedAudio, WavFormat} from "../src/types";

/**
 * Defines the expected properties of a decoded WAV file for verification.
 */
interface FixtureProperties {
    channels: number;
    sampleRate: number;
    bitDepth: number;
    samplesPerChannel: number;
    formatTag: number; // e.g., 1 for PCM, 6 for A-Law
}

/**
 * A map of fixture filenames to their known, correct properties,
 * derived directly from the provided Python generation script.
 * This acts as our "ground truth" for the tests.
 */
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


/**
 * A helper function to determine if the code is running in a Node.js environment.
 */
function isNodeEnv(): boolean {
    return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

/**
 * A helper function to load a fixture file in a way that works in both
 * Node.js and browser environments.
 * @param fixtureName The name of the file in the `tests/fixtures` directory.
 * @returns A promise that resolves to a Uint8Array of the file content.
 */
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

// Use the keys from our properties map as the list of fixtures to test.
const fixtures = Object.keys(fixtureProperties);

describe("WavStreamDecoder", () => {
    it("should decode various WAV files with correct properties", async () => {
        const decoder = new WavStreamDecoder();

        for (const fixture of fixtures) {
            console.log(`Verifying: ${fixture}`);

            // 1. Load the fixture file using our environment-aware helper
            const audioData = await loadFixture(fixture);
            expect(audioData.length).toBeGreaterThan(0);

            // 2. Decode the entire file at once
            const result: DecodedAudio = decoder.decode(audioData);

            // 3. Retrieve the "ground truth" properties for this file
            const expected = fixtureProperties[fixture];
            if (!expected) {
                throw new Error(`Missing fixture properties for ${fixture}`);
            }

            // 4. Perform detailed assertions against the known properties
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

            // 5. Reset the decoder's state to be ready for the next file
            decoder.reset();
        }
    });


    it("should decode audio frame by frame using decodeFrame", async () => {
        const decoder = new WavStreamDecoder();

        for (const fixture of fixtures) {
            console.log(`Verifying (decodeFrame): ${fixture}`);

            // 1. Load the file data
            const audioData = await loadFixture(fixture);
            const expected = fixtureProperties[fixture]!;

            // 2. Find the start of the 'data' chunk to separate header from audio body
            const dataChunkStart = findStringInUint8Array(audioData, 'data');
            expect(dataChunkStart, `File ${fixture} must contain a 'data' chunk`).toBeGreaterThan(-1);

            // The header includes the 'data' chunk ID and size (8 bytes)
            const headerEndOffset = dataChunkStart + 8;
            const header = audioData.subarray(0, headerEndOffset);
            const body = audioData.subarray(headerEndOffset);

            // 3. Initialize the decoder with the header. This should parse the format
            // but not decode any samples yet.
            const initialResult = decoder.decode(header);
            expect(initialResult.samplesDecoded).toBe(0);

            // FIX: Check for the correct state, State.DECODING (which is 1)
            expect(decoder.info.state).toBe(State.DECODING);

            const format = decoder.info.format as WavFormat;
            const {blockAlign} = format;
            expect(blockAlign, `File ${fixture} must have a valid blockAlign`).toBeGreaterThan(0);

            // 4. Feed the audio body to decodeFrame in chunks
            let totalSamplesDecoded = 0;
            const chunkSize = blockAlign * 512; // Process 512 frames at a time

            for (let offset = 0; offset < body.length; offset += chunkSize) {
                const chunk = body.subarray(offset, offset + chunkSize);

                // We only process full frames with decodeFrame
                const framesInChunk = Math.floor(chunk.length / blockAlign);
                if (framesInChunk === 0) continue;

                const frameData = chunk.subarray(0, framesInChunk * blockAlign);
                const frameResult = decoder.decodeFrame(frameData);

                expect(frameResult.errors, `File ${fixture} frame decoding should have no errors`).toEqual([]);
                totalSamplesDecoded += frameResult.samplesDecoded;
            }

            // 5. Verify the total number of decoded samples matches the expectation
            expect(totalSamplesDecoded).toBe(expected.samplesPerChannel);

            // 6. Reset for the next file
            decoder.reset();
        }
    });


    it("should handle flushing incomplete frames", async () => {
        const decoder = new WavStreamDecoder();
        const audioData = await loadFixture("pcm_d16_le_stereo.wav");

        // Take all but the last byte, creating an incomplete final frame
        const partialAudioData = audioData.subarray(0, audioData.length - 1);

        const result = decoder.decode(partialAudioData);

        // The decoder should have 3 bytes left in its internal buffer (one full byte + the incomplete one)
        // because blockAlign for this file is 4.
        const internalBuffer = (decoder as any).audioBuffer; // Access private property for testing
        expect(internalBuffer.available).toBe(3);

        // Now, flush the decoder
        const flushResult = await decoder.flush();

        // The flush result should contain no samples, as a full frame couldn't be formed.
        expect(flushResult).toBeNull();
        expect(internalBuffer.available).toBe(0); // Buffer should now be empty
        expect(decoder.info.state).toBe(State.ENDED);
        expect(decoder.info.errors[0].message).toContain("Discarded 3 bytes");
    });

    it("should free resources and end the decoder", async () => {
        const decoder = new WavStreamDecoder();
        const audioData = await loadFixture("pcm_d8_le_mono.wav");

        // Decode some data to populate the decoder's state
        decoder.decode(audioData.subarray(0, 128));
        expect(decoder.info.state).toBe(State.DECODING);
        expect(decoder.info.format.sampleRate).toBe(44100);

        // Call free
        decoder.free();

        // Verify state is ended and properties are reset
        expect(decoder.info.state).toBe(State.ENDED);
        expect(decoder.info.format).toEqual({});
        const internalBuffer = (decoder as any).audioBuffer;
        expect(internalBuffer.available).toBe(0);
    });
});

/**
 * Finds the starting index of a string pattern within a Uint8Array.
 * @param haystack The Uint8Array to search within.
 * @param needle The string to search for.
 * @returns The starting index of the needle, or -1 if not found.
 */
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

