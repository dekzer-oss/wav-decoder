import { type FixtureKey, fixtureProperties } from './fixtures';

const WAVE_FORMATS: Record<number, string> = {
  0x0001: 'PCM',
  0x0003: 'Float',
  0x0006: 'A-law',
  0x0007: 'µ-law',
};

export function describeFormat(key: FixtureKey): string {
  const { formatTag, bitDepth, channels } = fixtureProperties[key];
  const baseFormat = WAVE_FORMATS[formatTag] ?? `0x${formatTag.toString(16)}`;
  const bits = `${bitDepth}-bit`;
  const ch = channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels}ch`;
  return `${baseFormat} ${bits} ${ch}`;
}

export function inflateWavBody(src: Uint8Array, times = 32): Uint8Array {
  const dataPos = src.findIndex(
    (b, i) => i + 3 < src.length && src[i] === 0x64 && src[i + 1] === 0x61 && src[i + 2] === 0x74 && src[i + 3] === 0x61
  );
  if (dataPos < 0) throw new Error('data chunk not found');
  const sizeView = new DataView(src.buffer, src.byteOffset + dataPos + 4, 4);
  const bodySize = sizeView.getUint32(0, true);
  const headerEnd = dataPos + 8;
  const header = new Uint8Array(src.subarray(0, headerEnd));
  const body = src.subarray(headerEnd, headerEnd + bodySize);

  const bigBody = new Uint8Array(body.length * times);
  for (let i = 0; i < times; i++) bigBody.set(body, i * body.length);

  const riffSize = headerEnd - 8 + bigBody.length;
  const dataSizeLE = body.length * times;
  new DataView(header.buffer, header.byteOffset + 4, 4).setUint32(0, riffSize, true);
  new DataView(header.buffer, header.byteOffset + dataPos + 4, 4).setUint32(0, dataSizeLE, true);

  const out = new Uint8Array(header.length + bigBody.length);
  out.set(header, 0);
  out.set(bigBody, header.length);
  return out;
}
