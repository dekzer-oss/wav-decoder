# @dekzer/wav-decoder <!-- omit from toc -->

![Browser throughput](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/dekzer-oss/wav-decoder/main/bench/badge-browser.json)
![Node throughput](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/dekzer-oss/wav-decoder/main/bench/badge-node.json)

A small TypeScript/JavaScript library that **progressively decodes uncompressed WAV audio as the bytes arrive**.
It was written for in-house streaming experiments inside *Dekzer*, but we decided to publish the code because it may
save others some time. The API is intentionally minimal; please expect breaking changes until we tag a 1.0.0.

---

## Table of contents

1. [Status & project goals](#status--project-goals)
2. [Features](#features)
3. [Installation](#installation)
4. [Quick example](#quick-example)
5. [Detailed API](#detailed-api)
6. [Supported formats, platforms & limits](#supported-formats-platforms--limits)
7. [Development & testing](#development--testing)
8. [License](#license)

---

## Status & project goals

|                       |                                                                                             |
|-----------------------|---------------------------------------------------------------------------------------------|
| **Maturity**          | Internal prototype; usable, but not yet frozen.                                             |
| **Stability promise** | Semantic-versioning will start at v1.0.0. Until then new releases *might* introduce breaks. |
| **Road-map**          | Optimize Node through-put. Optional worker/Worklet wrapper.                                 |

---

## Features

* **Chunk-by-chunk decoding** – start playback before the file is finished downloading.
* **No runtime dependencies** – the package.json lists only dev-deps and peer-less prod code.
* **Broad PCM coverage** – 8/16/24/32-bit PCM, 32/64-bit float, A-law and µ-law, little- and big-endian.
  The unit-tests run those variants against ~20 fixtures.
* **Works in Node 20+ and modern browsers**; for browsers you can pipe the decoded Float32Arrays straight into an
  `AudioContext`.

---

## Installation

```bash
# with pnpm
pnpm add @dekzer/wav-decoder

# or npm
npm install @dekzer/wav-decoder
```

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
      // `out.channelData` is Float32Array[] (interleaved already split per channel)
      playChunk(out.channelData, out.sampleRate);
    }
  }

  const tail = decoder.flush();
  if (tail.samplesDecoded) playChunk(tail.channelData, tail.sampleRate);
}
```

---

## Detailed API

### `class WavDecoder`

| Member                                         | Description                                                                                                                                                                            |
|------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **constructor()**                              | Allocates internal ring-buffer (default 64 KiB).                                                                                                                                       |
| **decode(chunk: Uint8Array): DecodedWavAudio** | Feed arbitrary-sized data. Returns samples (may be zero) and non-fatal error list.                                                                                                     |
| **decodeFrames(chunkAlignedToBlock)**          | Same as `decode`, but *requires* that `chunk.length % format.blockSize === 0` for maximum throughput.                                                                                  |
| **decodeFrame(frame)**                         | Decodes *one* interleaved frame and returns a `Float32Array` with `channels` elements, or `null` if the frame is incomplete. Used in performance-critical code paths (see benchmarks). |
| **flush()**                                    | Drains any remaining bytes (including a partial final block). Useful when the stream closes.                                                                                           |
| **reset()**                                    | Clears internal state so the instance can be re-used.                                                                                                                                  |
| **free()**                                     | Releases the ring-buffer and changes `info.state` to `ENDED`; subsequent calls are no-ops.                                                                                             |
| **info** *(read-only)*                         | Live diagnostics object described below.                                                                                                                                               |

#### `DecodedWavAudio`

```ts
{
  channelData: Float32Array[]; // one array per channel
  samplesDecoded: number;      // samples added by *this* call
  sampleRate: number;          // independent copy for convenience
  errors: DecodeError[];       // non-fatal issues (clipped sample, NaN, …)
}
```

#### `decoder.info`

| Field          | Notes                                                                                                   |
|----------------|---------------------------------------------------------------------------------------------------------|
| `state`        | `DecoderState.IDLE \| DECODING \| ENDED \| ERROR`.                                                      |
| `format`       | Populated after the `fmt ` chunk is parsed: `{ formatTag, channels, sampleRate, bitDepth, blockSize }`. |
| `decodedBytes` | Total bytes written into PCM output so far.                                                             |
| `progress`     | Fraction 0–1 based on WAV `data` chunk size (falls back to `NaN` if size unknown).                      |
| `errors`       | Array of the last few `DecodeError`s; a *fatal* error switches `state` to `ERROR`.                      |

#### `enum DecoderState`

Exact numeric values are private – rely only on the names:

```ts
IDLE = 0, DECODING = 1, ENDED = 2, ERROR = 3
```

---

## Supported formats, platforms & limits

| Aspect              | Notes                                                                                 |
|---------------------|---------------------------------------------------------------------------------------|
| **Containers**      | RIFF `WAVE` (little-endian) & RIFX (big-endian).                                      |
| **Codecs**          | 0x0001 PCM, 0x0003 IEEE float, 0x0006 A-law, 0x0007 µ-law.                            |
| **Bits per sample** | 8/16/24/32-bit integer, 32/64-bit float.                                              |
| **Channels**        | 1 … 8 tested; more should work, memory permitting.                                    |
| **Sample-rate**     | Any positive integer ≤ 192 kHz (no fixed list).                                       |
| **File size**       | Limited only by the host stream; decoding is constant-memory.                         |
| **Not supported**   | ADPCM, MPEG-encoded “WAV”, broadcast extensions, cue lists.                           |
| **Browsers**        | Requires `ReadableStream` and `AudioContext` (≈ Chrome 94+, Firefox 92+, Safari 15+). |
| **Node**            | Node 20 or newer (streams with BYOB readers were simplified in 20).                   |

---

## Development & testing

Clone and install with **pnpm >= 8**.

```bash
pnpm install          # grabs dev-deps only
pnpm test             # vitest: Node + happy-dom browser suite
pnpm bench            # micro-benchmarks for several fixtures
pnpm demo             # vite – opens the browser demos
```

CI runs `vitest`, Playwright browser tests and size-limited benchmarks on each PR.&#x20;

Fixtures are generated from pure-Python (`scripts/gen-wav-fixtures.py`) – no copyrighted samples.&#x20;

---

## License

MIT – see [LICENSE](./LICENSE). No warranty.
