# @dekzer/wav-decoder


A TypeScript/JavaScript library that progressively decodes uncompressed WAV audio as the bytes arrive.

**Please expect breaking changes until we tag a 1.0.0.**

---

## Installation

```bash
# with pnpm
pnpm add @dekzer/wav-decoder

# or npm
npm install @dekzer/wav-decoder
````

No post-install scripts, no optional binaries.

---

## Quick example

```ts
import { WavDecoder } from '@dekzer/wav-decoder';

async function streamAndPlay(url: string) {
  const decoder = new WavDecoder();
  const response = await fetch(url);
  const reader = response.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const out = decoder.decode(value);
    if (out.samplesDecoded) {
      playChunk(out.channelData, out.sampleRate);
    }
  }

  const tail = decoder.flush();
  if (tail.samplesDecoded) {
    playChunk(tail.channelData, tail.sampleRate);
  }
}
```

---

## Live Demos

Try the decoder in your browser or use these as **starter templates**:

| Demo                                            | Description                                                             | Source                                        |
|-------------------------------------------------|-------------------------------------------------------------------------|-----------------------------------------------|
| [Full UI demo](index.html)                      | Drag & drop WAV, see detailed metrics, chunked decoding, playback, logs | [`index.html`](index.html)                    |
| [Starter demo](starter.html)                    | 20 lines of code: pure decode, metrics, and progress bar                | [`starter-demo.html`](starter.html)           |
| [Streaming playback demo](stream-and-play.html) | Streams a WAV file, progressive decode & low-latency playback           | [`streaming-demo.html`](stream-and-play.html) |

---

## License

MIT – see [LICENSE](./LICENSE). No warranty.
