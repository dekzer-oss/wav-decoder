import { expect } from "vitest";
import { WavStreamDecoder } from "../../src";
import { loadFixture } from "./loadFixture";
import {type FixtureProperties, fixtureProperties} from "./fixtureMeta";
import type { DecodedAudio } from "../../src";

export async function decodeFixtureOnce(fixture: string) {
    const decoder = new WavStreamDecoder();
    const buffer = await loadFixture(fixture);
    const decoded: DecodedAudio = decoder.decode(buffer);
    const expected = fixtureProperties[fixture] as FixtureProperties;
    decoder.free();

    expect(decoded.errors).toEqual([]);
    expect(decoded.channelData.length).toBe(expected.channels);

    return {
        decoded,
        expected,
    };
}
