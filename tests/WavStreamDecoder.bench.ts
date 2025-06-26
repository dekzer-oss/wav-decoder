import {describe, bench, beforeAll} from "vitest";
import {WavStreamDecoder} from "../src";
import {fixtureProperties} from "./utils/fixtureMeta";
import {loadFixture} from "./utils/loadFixture";
import {findStringInUint8Array} from "./fixtures/helpers";

const loadedFixtures = new Map<string, Uint8Array>();

beforeAll(async () => {
    const fixtureNames = Object.keys(fixtureProperties);
    const loadPromises = fixtureNames.map(name => loadFixture(name));
    const audioDataArray = await Promise.all(loadPromises);

    fixtureNames.forEach((name, index) => {
        loadedFixtures.set(name, audioDataArray[index]!);
    });
});

describe("WavStreamDecoder full decode() performance", () => {
    for (const fixture of Object.keys(fixtureProperties)) {
        bench(`${fixture} - full file`, () => {
            const data = loadedFixtures.get(fixture)!;
            const decoder = new WavStreamDecoder();
            decoder.decode(data);
            decoder.free();
        });
    }
});

describe("WavStreamDecoder decodeFrame() performance", () => {
    bench("pcm_d16_le_stereo.wav - frame-by-frame (chunked)", () => {
        const data = loadedFixtures.get("pcm_d16_le_stereo.wav")!;
        const decoder = new WavStreamDecoder();

        const dataOffset = findStringInUint8Array(data, 'data');
        const headerEnd = dataOffset + 8;

        decoder.decode(data.subarray(0, headerEnd));

        const body = data.subarray(headerEnd);
        const { blockAlign } = decoder.info.format;
        const chunkSize = blockAlign * 512;

        // Process audio body in chunks
        for (let i = 0; i < body.length; i += chunkSize) {
            const chunk = body.subarray(i, i + chunkSize);
            const framesInChunk = Math.floor(chunk.length / blockAlign);
            if (framesInChunk > 0) {
                decoder.decodeFrame(chunk.subarray(0, framesInChunk * blockAlign));
            }
        }

        decoder.free();
    });
});
