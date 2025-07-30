import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { WasmDecoder } from 'src/WasmDecoder';
import { DecoderState } from 'src/types';

let decoder: WasmDecoder;

beforeAll(async () => {
  decoder = await WasmDecoder.create();
});

beforeEach(() => {
  decoder.reset();
});

afterEach(() => {
  decoder.free();
});

describe('WasmDecoder', () => {
  it('initializes correctly', () => {
    expect(decoder).toBeInstanceOf(WasmDecoder);
    expect(decoder.state).toBe(DecoderState.IDLE);
    expect(decoder.info).toBeDefined();
  });
});
