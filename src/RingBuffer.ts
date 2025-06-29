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
    if ((capacity & (capacity - 1)) !== 0) {
      throw new Error('Capacity must be a power of two');
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

    const bytesToWrite = Math.min(len, this.freeSpace);
    if (bytesToWrite === 0) return 0;

    const part1 = Math.min(bytesToWrite, this.capacity - this.writePos);
    const part2 = bytesToWrite - part1;

    for (let i = 0; i < part1; i++) {
      this.buffer[this.writePos + i] = data[i]!;
    }
    for (let i = 0; i < part2; i++) {
      this.buffer[i] = data[part1 + i]!;
    }

    this.writePos = (this.writePos + bytesToWrite) & this.mask;
    this._size += bytesToWrite;
    return bytesToWrite;
  }

  /**
   * Reads data into a pre-allocated target buffer.
   * Returns `false` if not enough data is available.
   */
  readInto(target: Uint8Array): boolean {
    const length = target.length;
    if (this._size < length) return false;

    const part1 = Math.min(length, this.capacity - this.readPos);
    const part2 = length - part1;

    for (let i = 0; i < part1; i++) {
      target[i] = this.buffer[this.readPos + i]!;
    }
    for (let i = 0; i < part2; i++) {
      target[part1 + i] = this.buffer[i]!;
    }

    this.readPos = (this.readPos + length) & this.mask;
    this._size -= length;
    return true;
  }

  /**
   * Reads a new `Uint8Array` of the given length.
   * Returns `null` if not enough data is available.
   */
  read(length: number): Uint8Array | null {
    if (length <= 0 || this._size < length) return null;

    const result = new Uint8Array(length);
    this.readInto(result);
    return result;
  }

  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this._size = 0;
  }
}
