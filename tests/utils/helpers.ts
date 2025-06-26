export function findStringInUint8Array(haystack: Uint8Array, needle: string): number {
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

export async function loadFixture(fixtureName: string): Promise<Uint8Array> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.resolve(__dirname, '../fixtures', fixtureName);
    const fileBuffer = await fs.readFile(fixturePath);
    return new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.length);
  } else {
    const response = await fetch(`/tests/fixtures/${fixtureName}`);
    if (!response.ok) throw new Error(`Failed to fetch fixture: ${fixtureName}`);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}
