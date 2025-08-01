import { RingBuffer } from '../core';

/**
 * A wrapper around RingBuffer to provide a simpler, stream-like API.
 */
export class StreamBuffer {
  private ringBuffer: RingBuffer;

  constructor(size: number) {
    this.ringBuffer = new RingBuffer(size);
  }

  public get available(): number {
    return this.ringBuffer.available;
  }

  public append(data: Uint8Array): number {
    return this.ringBuffer.write(data);
  }

  public peekContiguous(): Uint8Array {
    return this.ringBuffer.peekContiguous();
  }

  public peek(length: number, offset = 0): Uint8Array {
    return this.ringBuffer.peek(length, offset);
  }

  public read(length: number): Uint8Array {
    const available = this.available;
    if (available < length) return this.peek(available);
    const data = this.peek(length);
    this.discard(length);
    return data;
  }

  public discard(length: number): void {
    this.ringBuffer.discard(length);
  }

  public clear(): void {
    this.ringBuffer.clear();
  }
}
