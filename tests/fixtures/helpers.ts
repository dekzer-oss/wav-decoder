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

