/**
 * A high-performance, dependency-free circular buffer optimized for low-latency streaming.
 * Capacity must be a power of two.
 */
export class RingBuffer {
  public readonly capacity: number;
  private readonly mask: number;
  private readonly buffer: Uint8Array;
  private writePos = 0;
  private readPos = 0;
  private _size = 0;

  constructor(capacity: number) {
    if ((capacity & (capacity - 1)) !== 0 || capacity < 2) {
      throw new Error('Capacity must be a power of two and at least 2');
    }

    this.capacity = capacity;
    this.mask = capacity - 1;
    this.buffer = new Uint8Array(capacity);
  }

  get available(): number {
    return this._size;
  }

  get freeSpace(): number {
    return this.capacity - this._size;
  }

  write(data: Uint8Array): number {
    const len = data.length;
    if (len === 0) return 0;

    const free = this.capacity - this._size;
    if (free === 0) return 0;

    const bytesToWrite = len > free ? free : len;
    const wp = this.writePos;
    const buffer = this.buffer;

    const firstChunk = this.capacity - wp;
    if (bytesToWrite <= firstChunk) {
      buffer.set(data.subarray(0, bytesToWrite), wp);
    } else {
      buffer.set(data.subarray(0, firstChunk), wp);
      buffer.set(data.subarray(firstChunk, bytesToWrite), 0);
    }

    this.writePos = (wp + bytesToWrite) & this.mask;
    this._size += bytesToWrite;
    return bytesToWrite;
  }

  readInto(target: Uint8Array): boolean {
    const length = target.length;
    if (length === 0) return true;
    if (this._size < length) return false;

    const rp = this.readPos;
    const buffer = this.buffer;
    const firstChunk = this.capacity - rp;

    if (length <= firstChunk) {
      target.set(buffer.subarray(rp, rp + length), 0);
    } else {
      target.set(buffer.subarray(rp, rp + firstChunk), 0);
      target.set(buffer.subarray(0, length - firstChunk), firstChunk);
    }

    this.readPos = (rp + length) & this.mask;
    this._size -= length;
    return true;
  }

  read(length: number): Uint8Array | null {
    if (this._size < length) return null;
    const result = new Uint8Array(length);
    this.readInto(result);
    return result;
  }

  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this._size = 0;
  }

  peek(length: number): Uint8Array | null {
    if (this._size < length) return null;
    const rp = this.readPos;
    if (rp + length <= this.capacity) {
      return this.buffer.subarray(rp, rp + length);
    }
    return null;
  }

  discard(bytes: number): void {
    if (bytes > this._size) bytes = this._size;
    this.readPos = (this.readPos + bytes) & this.mask;
    this._size -= bytes;
  }

  peekContiguous(): Uint8Array {
    const rp = this.readPos;
    const length = Math.min(this._size, this.capacity - rp);
    return this.buffer.subarray(rp, rp + length);
  }
}
