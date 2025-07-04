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
  private size = 0;

  /**
   * Creates an instance of RingBuffer.
   * @param capacity The capacity of the buffer. Must be a power of two and at least 2.
   */
  constructor(capacity: number) {
    if ((capacity & (capacity - 1)) !== 0 || capacity < 2) {
      throw new Error('Capacity must be a power of two and at least 2');
    }

    this.capacity = capacity;
    this.mask = capacity - 1;
    this.buffer = new Uint8Array(capacity);
  }

  /**
   * The number of bytes available to be read from the buffer.
   */
  get available(): number {
    return this.size;
  }

  /**
   * Writes data to the buffer.
   * @param data The data to write.
   * @returns The number of bytes actually written. This can be less than the data length if the buffer is full.
   */
  write(data: Uint8Array): number {
    const len = data.length;
    if (len === 0) return 0;

    const free = this.capacity - this.size;
    if (free === 0) return 0;

    const bytesToWrite = len > free ? free : len;
    const wp = this.writePos;
    const buffer = this.buffer;

    const firstChunk = this.capacity - wp;
    if (bytesToWrite <= firstChunk) {
      // Data fits in a single contiguous block.
      buffer.set(data.subarray(0, bytesToWrite), wp);
    } else {
      // Data wraps around the end of the buffer.
      buffer.set(data.subarray(0, firstChunk), wp);
      buffer.set(data.subarray(firstChunk, bytesToWrite), 0);
    }

    this.writePos = (wp + bytesToWrite) & this.mask;
    this.size += bytesToWrite;
    return bytesToWrite;
  }

  /**
   * Reads data from the buffer into a provided target array.
   * @param target The array to read data into. The buffer must have at least `target.length` bytes available.
   * @returns `true` if the read was successful, `false` if there was not enough data in the buffer.
   */
  readInto(target: Uint8Array): boolean {
    const length = target.length;
    if (length === 0) return true;
    if (this.size < length) return false;

    const rp = this.readPos;
    const buffer = this.buffer;
    const firstChunk = this.capacity - rp;

    if (length <= firstChunk) {
      // Data is in a single contiguous block.
      target.set(buffer.subarray(rp, rp + length), 0);
    } else {
      // Data wraps around the end of the buffer.
      target.set(buffer.subarray(rp, rp + firstChunk), 0);
      target.set(buffer.subarray(0, length - firstChunk), firstChunk);
    }

    this.readPos = (rp + length) & this.mask;
    this.size -= length;
    return true;
  }

  /**
   * Reads a specified number of bytes from the buffer.
   * @param length The number of bytes to read.
   * @returns A new Uint8Array with the data, or null if not enough data is available.
   */
  read(length: number): Uint8Array | null {
    if (this.size < length) return null;
    const result = new Uint8Array(length);
    // readInto will always succeed here because we checked the size.
    this.readInto(result);
    return result;
  }

  /**
   * Clears the buffer, resetting all positions and the size.
   */
  clear(): void {
    this.writePos = 0;
    this.readPos = 0;
    this.size = 0;
  }

  /**
   * Discards a specified number of bytes from the read position.
   * @param bytes The number of bytes to discard.
   */
  discard(bytes: number): void {
    if (bytes > this.size) bytes = this.size;
    this.readPos = (this.readPos + bytes) & this.mask;
    this.size -= bytes;
  }

  /**
   * Returns a view of the readable data as a contiguous block.
   * Note: This may not represent all available data if the buffer wraps around.
   * It returns the longest possible block of data starting from the read position.
   * @returns A Uint8Array view of the contiguous readable data.
   */
  peekContiguous(): Uint8Array {
    const rp = this.readPos;
    const length = Math.min(this.size, this.capacity - rp);
    return this.buffer.subarray(rp, rp + length);
  }
}
