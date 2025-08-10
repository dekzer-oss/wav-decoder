# @dekzer/wav-decoder

[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f?logo=github)](https://dekzer-oss.github.io/wav-decoder/)
[![Deploy Pages](https://github.com/dekzer-oss/wav-decoder/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/dekzer-oss/wav-decoder/actions/workflows/deploy.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js)](https://nodejs.org/)

[![Browsers](https://img.shields.io/badge/Chrome%20124%2B%20%7C%20Firefox%20110%2B%20%7C%20Edge%20124%2B-blue?logo=googlechrome)](#supported-formats--limits)
[![Safari](https://img.shields.io/badge/Safari-Reader%20Pattern%20Required-orange?logo=safari)](#supported-formats--limits)

A TypeScript/JavaScript library for **progressive decoding** of uncompressed WAV audio files *as bytes
arrive*. Optimized for Chromium while maintaining compatibility with all modern browsers and Node.js 20+. Breaking
changes may occur before **v1.0.0**.

---

## Table of Contents

1. [Status & Goals](#status--goals)
2. [Features](#features)
3. [Installation](#installation)
4. [Quick Example](#quick-example)
5. [Live Demos](#live-demos)
6. [API](#api)
7. [Usage Examples](#usage-examples)
8. [Supported Formats & Limits](#supported-formats--limits)
9. [Development & Testing](#development--testing)
10. [License](#license)

---

## Status & Goals

| Aspect        | Status                                                            |
|---------------|-------------------------------------------------------------------|
| **Maturity**  | Internal prototype: functional but APIs not finalized             |
| **Stability** | Pre-v1.0.0 releases may contain breaking API changes              |
| **Roadmap**   | Node.js throughput optimization, optional Worker/Worklet wrappers |

---

## Features

- **Progressive decoding** - Process audio chunks as they arrive
- **Zero dependencies** - Runtime dependency-free (dev-only in `package.json`)
- **Broad format support** - 8/16/24/32-bit PCM, 32/64-bit float, A-law/µ-law (little/big-endian)
- **Cross-platform** - Compatible with Node.js 20+ and modern browsers
- **AudioContext-ready** - Directly pipe `Float32Array[]` output to Web Audio API
- **Rigorous testing** - Validated against ~20 fixture WAV files

---

## Installation

```bash
# pnpm
pnpm add @dekzer/wav-decoder

# npm
npm install @dekzer/wav-decoder
```

No post-install scripts or optional binaries.

---

## Quick Example

```ts
import { WavDecoder } from '@dekzer/wav-decoder';

async function streamAndPlay(url: string) {
  const decoder = new WavDecoder();

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();

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

Explore these interactive examples to accelerate integration:

| Demo                                                                           | Description                                   | Source                                         |
|--------------------------------------------------------------------------------|-----------------------------------------------|------------------------------------------------|
| [Full UI Demo](https://dekzer-oss.github.io/wav-decoder)                       | Drag & drop, metrics, playback visualization  | [`index.html`](index.html)                     |
| [Starter Demo](https://dekzer-oss.github.io/wav-decoder/starter)               | Minimal implementation with progress tracking | [`starter.html`](starter.html)                 |
| [Streaming Playback](https://dekzer-oss.github.io/wav-decoder/stream-and-play) | Low-latency streaming decode & playback       | [`stream-and-play.html`](stream-and-play.html) |

---

## API

### `class WavDecoder`

| Method                        | Description                                                      |
|-------------------------------|------------------------------------------------------------------|
| **constructor()**             | Initializes with 64 KiB ring buffer (default)                    |
| **decode(chunk: Uint8Array)** | Processes incoming bytes; returns decoded samples                |
| **flush()**                   | Finalizes decoding of remaining bytes (including partial blocks) |
| **reset()**                   | Clears state for instance reuse                                  |
| **free()**                    | Releases resources and sets `info.state` to `ENDED`              |
| **info** *(read-only)*        | Real-time diagnostics object                                     |

#### Output Structure (`DecodedWavAudio`)

```ts
{
  channelData: Float32Array[];  // Per-channel audio buffers
  samplesDecoded: number;       // Samples decoded in this operation
  sampleRate: number;           // Extracted from WAV header
  errors: DecodeError[];        // Non-fatal decoding issues
}
```

#### `decoder.info` Properties

| Property       | Description                                                  |
|----------------|--------------------------------------------------------------|
| `state`        | `DecoderState.IDLE` \| `DECODING` \| `ENDED` \| `ERROR`      |
| `format`       | Header details (`formatTag`, `channels`, `sampleRate`, etc.) |
| `decodedBytes` | Cumulative PCM bytes decoded                                 |
| `progress`     | Completion ratio (0–1, NaN if unknown)                       |
| `errors`       | Recent non-fatal errors (fatal errors set `state = ERROR`)   |

---

## Usage Examples

### Basic streaming (fetch)

```ts
import { WavDecoder } from '@dekzer/wav-decoder';

const decoder = new WavDecoder();
const response = await fetch(url);

for await (const chunk of response.body) {
  const { channelData, samplesDecoded, sampleRate } = decoder.decode(chunk);
  if (samplesDecoded) playChunk(channelData, sampleRate);
}

const tail = decoder.flush();
if (tail.samplesDecoded) playChunk(tail.channelData, tail.sampleRate);
```

### Local file processing (File/Blob)

```ts
async function processFile(file: File) {
  const decoder = new WavDecoder();

  for await (const chunk of file.stream()) {
    const out = decoder.decode(chunk);
    if (out.samplesDecoded) playChunk(out.channelData, out.sampleRate);
  }

  const tail = decoder.flush();
  if (tail.samplesDecoded) playChunk(tail.channelData, tail.sampleRate);
}
```

### TransformStream integration

```ts
function createWavDecoder() {
  const decoder = new WavDecoder();

  return new TransformStream({
    transform(chunk, controller) {
      const out = decoder.decode(chunk);
      if (out.samplesDecoded) controller.enqueue(out);
    },
    flush(controller) {
      const tail = decoder.flush();
      if (tail.samplesDecoded) controller.enqueue(tail);
    }
  });
}

await response.body
  .pipeThrough(createWavDecoder())
  .pipeTo(new WritableStream({
    write({ channelData, sampleRate }) {
      playChunk(channelData, sampleRate);
    }
  }));
```

---

## Supported Formats & Limits

| Category        | Support                                                                          |
|-----------------|----------------------------------------------------------------------------------|
| **Containers**  | RIFF `WAVE` (LE), RIFX (BE)                                                      |
| **Encodings**   | PCM, IEEE float, A-law, µ-law                                                    |
| **Bit Depth**   | 8/16/24/32-bit int, 32/64-bit float                                              |
| **Channels**    | 1–8 (theoretically unlimited)                                                    |
| **Sample Rate** | ≤ 192 kHz                                                                        |
| **Constraints** | Constant-memory streaming (no file size limits)                                  |
| **Exclusions**  | ADPCM, MPEG-WAV, broadcast extensions, cue lists                                 |
| **Browsers**    | Requires `ReadableStream` + `AudioContext` (Chrome 94+, Firefox 92+, Safari 15+) |
| **Node.js**     | Version 20+ (simplified BYOB readers)                                            |

### Browser Compatibility Notes

- **Async iteration over `ReadableStream`**: Chrome 124+, Firefox 110+, Edge 124+
- **Safari**: Use reader pattern for broader compatibility
- **All examples** provide fallback patterns for maximum browser support

---

## Development & Testing

```bash
pnpm install   # Install dev dependencies
pnpm test      # Run Vitest (Node + browser)
pnpm bench     # Execute micro-benchmarks
pnpm demo      # Launch Vite development server
```

- Continuous integration includes Vitest, Playwright tests, and benchmarks
- Fixtures generated via `scripts/gen-wav-fixtures.py` (no copyrighted material)

---

## License

MIT - See [LICENSE](./LICENSE)
