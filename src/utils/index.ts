import { WavDecoder } from '../WavDecoder';

export interface LoadOptions {
  chunkSize?: number;
  onChunk?: (result: ReturnType<WavDecoder['decode']>) => void;
  onFinal?: (result: ReturnType<WavDecoder['flush']>) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class SegmentedWavLoader {
  private decoder = new WavDecoder();
  private readonly chunkSize: number;
  private readonly url: string;

  constructor(url: string, chunkSize = 65536) {
    this.url = url;
    this.chunkSize = chunkSize;
  }

  async stream(options: LoadOptions = {}) {
    const { onChunk = () => {}, onFinal = () => {}, onProgress = () => {}, signal } = options;

    const totalSize = await this.getContentLength();
    if (!totalSize) throw new Error('Unable to determine content length');

    let offset = 0;
    while (offset < totalSize) {
      if (signal?.aborted) break;

      const end = Math.min(offset + this.chunkSize - 1, totalSize - 1);
      const chunk = await this.fetchRange(offset, end, signal);

      const result = this.decoder.decode(chunk);
      onChunk(result);

      offset += chunk.length;
      onProgress(offset / totalSize);
    }

    const final = this.decoder.flush();
    onFinal(final);
  }

  private async getContentLength(): Promise<number> {
    const resp = await fetch(this.url, { method: 'HEAD' });
    const len = resp.headers.get('Content-Length');
    return len ? parseInt(len, 10) : 0;
  }

  private async fetchRange(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
    const resp = await fetch(this.url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });

    if (!resp.ok && resp.status !== 206) {
      throw new Error(`Expected 206 Partial Content, got ${resp.status}`);
    }

    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
