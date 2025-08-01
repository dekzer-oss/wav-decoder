/**
 * Manages a pool of Float32Array arrays to reuse memory and reduce GC pressure.
 */
export class AudioBufferPool {
  private pool: Float32Array[][] = [];
  private readonly maxSamplesPerBuffer: number;

  constructor(maxSamplesPerBuffer = 4096 * 8) {
    this.maxSamplesPerBuffer = maxSamplesPerBuffer;
  }

  /**
   * Acquires a set of channel buffers from the pool.
   * @param channels The number of channels required.
   * @param samples The number of samples required per channel.
   * @returns An array of Float32Arrays.
   */
  public get(channels: number, samples: number): Float32Array[] {
    if (this.pool.length > 0) {
      const buffers = this.pool.pop()!;
      if (buffers.length === channels && buffers[0]!.length >= samples) {
        return buffers.map((b) => b.subarray(0, samples));
      }
    }
    const size = Math.max(samples, this.maxSamplesPerBuffer);
    return Array.from({ length: channels }, () => new Float32Array(size));
  }

  /**
   * Returns a set of channel buffers to the pool for later reuse.
   * @param buffers The array of Float32Arrays to release.
   */
  public release(buffers: Float32Array[][]): void {
    this.pool.push(...buffers);
  }

  /**
   * Clears all buffers from the pool.
   */
  public clear(): void {
    this.pool.length = 0;
  }
}
