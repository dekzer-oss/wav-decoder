import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../src/RingBuffer';

describe('RingBuffer', () => {
  describe('Basic Validations', () => {
    it('should throw on invalid capacity (not power of two)', () => {
      expect(() => new RingBuffer(3)).toThrow('Capacity must be a power of two and at least 2');
      expect(() => new RingBuffer(0)).toThrow('Capacity must be a power of two and at least 2');
      expect(() => new RingBuffer(1)).toThrow('Capacity must be a power of two and at least 2');
    });

    it('should write and read data correctly', () => {
      const buf = new RingBuffer(8);
      const data = Uint8Array.from([1, 2, 3, 4]);
      const written = buf.write(data);
      expect(written).toBe(4);
      expect(buf.available).toBe(4);
      const out = new Uint8Array(4);
      const ok = buf.readInto(out);
      expect(ok).toBe(true);
      expect(Array.from(out)).toEqual([1, 2, 3, 4]);
      expect(buf.available).toBe(0);
    });
  });

  describe('Wraparound Handling', () => {
    it('should wrap correctly and preserve data order', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4, 5, 6]));
      const out1 = new Uint8Array(4);
      buf.readInto(out1); // read [1,2,3,4], now writePos=6, readPos=4
      expect(Array.from(out1)).toEqual([1, 2, 3, 4]);
      buf.write(Uint8Array.from([7, 8, 9, 10])); // should wrap
      expect(buf.available).toBe(6);
      const out2 = new Uint8Array(6);
      buf.readInto(out2);
      expect(Array.from(out2)).toEqual([5, 6, 7, 8, 9, 10]);
    });
  });

  describe('Peeking Behavior', () => {
    it('should support peekContiguous before wrap', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4]));
      const peek = buf.peekContiguous();
      expect(Array.from(peek)).toEqual([1, 2, 3, 4]);
    });
    it('should support peekContiguous after wrap', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4, 5, 6]));
      buf.readInto(new Uint8Array(6)); // move readPos to 6
      buf.write(Uint8Array.from([7, 8, 9, 10])); // wrap
      // Now readPos=6, writePos=2, available=4
      const peek = buf.peekContiguous();
      expect(Array.from(peek)).toEqual([7, 8]); // only contiguous from readPos
      buf.readInto(new Uint8Array(2)); // read 7,8, now readPos=0
      const peek2 = buf.peekContiguous();
      expect(Array.from(peek2)).toEqual([9, 10]);
    });
  });

  describe('Discarding', () => {
    it('should discard bytes correctly', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4, 5]));
      buf.discard(2);
      expect(buf.available).toBe(3);
      const out = new Uint8Array(3);
      buf.readInto(out);
      expect(Array.from(out)).toEqual([3, 4, 5]);
    });
    it('should not discard more than available', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3]));
      buf.discard(10);
      expect(buf.available).toBe(0);
    });
  });

  describe('clear', () => {
    it('should reset buffer state', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4]));
      buf.clear();
      expect(buf.available).toBe(0);
      // After clear, should be able to write full capacity
      const written = buf.write(Uint8Array.from([5, 6, 7, 8, 9, 10, 11, 12]));
      expect(written).toBe(8);
      expect(buf.available).toBe(8);
    });
  });

  describe('zero-length operations', () => {
    it('should handle zero-length write', () => {
      const buf = new RingBuffer(8);
      const written = buf.write(new Uint8Array(0));
      expect(written).toBe(0);
      expect(buf.available).toBe(0);
    });
    it('should handle zero-length readInto', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3]));
      const out = new Uint8Array(0);
      const ok = buf.readInto(out);
      expect(ok).toBe(true);
      expect(buf.available).toBe(3);
    });
  });

  describe('partial write', () => {
    it('should only write up to free space', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])); // fill
      const written = buf.write(Uint8Array.from([9, 10]));
      expect(written).toBe(0); // no space
      buf.readInto(new Uint8Array(6)); // free up 6
      const written2 = buf.write(Uint8Array.from([9, 10, 11, 12, 13, 14, 15]));
      expect(written2).toBe(6); // only 6 free
      expect(buf.available).toBe(8);
      const out = new Uint8Array(8);
      buf.readInto(out);
      expect(Array.from(out)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    });
  });

  describe('read() insufficient data', () => {
    it('should return null if not enough data', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3]));
      const result = buf.read(5);
      expect(result).toBeNull();
      // Should not consume data
      expect(buf.available).toBe(3);
    });

    it('should return data if enough available', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3, 4, 5]));
      const result = buf.read(5);
      expect(result).not.toBeNull();
      expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5]);
      expect(buf.available).toBe(0);
    });
  });

  describe('property-based/randomized', () => {
    it('should correctly write and read random data in random chunk sizes', () => {
      const buf = new RingBuffer(64);
      const reference: number[] = [];
      let totalWritten = 0;
      let totalRead = 0;
      for (let i = 0; i < 100; i++) {
        // Random write size (1-16)
        const writeSize = Math.floor(Math.random() * 16) + 1;
        const data = Uint8Array.from({ length: writeSize }, () => Math.floor(Math.random() * 256));
        const written = buf.write(data);
        reference.push(...Array.from(data.slice(0, written)));
        totalWritten += written;
        // Random read size (1-16)
        const readSize = Math.floor(Math.random() * 16) + 1;
        const out = new Uint8Array(readSize);
        const ok = buf.readInto(out);
        if (ok) {
          const expected = reference.splice(0, readSize);
          expect(Array.from(out)).toEqual(expected);
          totalRead += readSize;
        } else {
          // Not enough data, should not consume
          expect(buf.available).toBe(reference.length);
        }
      }
      // Drain remaining
      while (buf.available > 0) {
        const out = new Uint8Array(buf.available);
        buf.readInto(out);
        const expected = reference.splice(0, out.length);
        expect(Array.from(out)).toEqual(expected);
      }
      expect(reference.length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('discard(0) should be a no-op', () => {
      const buf = new RingBuffer(8);
      buf.write(Uint8Array.from([1, 2, 3]));
      buf.discard(0);
      expect(buf.available).toBe(3);
      const out = new Uint8Array(3);
      buf.readInto(out);
      expect(Array.from(out)).toEqual([1, 2, 3]);
    });
  });
});
