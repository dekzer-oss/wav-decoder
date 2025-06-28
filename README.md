# 🎷 streaming-wav-decoder

A robust, streaming-capable WAV audio decoder with full PCM and float support — zero dependencies, works anywhere JavaScript runs.

[![npm version](https://img.shields.io/npm/v/streaming-wav-decoder.svg)](https://www.npmjs.com/package/streaming-wav-decoder)
[![CI Status](https://img.shields.io/github/actions/workflow/status/dekzer-oss/streaming-wav-decoder/main.yml?branch=main&label=CI&logo=github)](https://github.com/dekzer-oss/streaming-wav-decoder/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

### The Modern Solution for Browser-Based Audio

Native decoding via `AudioContext.decodeAudioData` is powerful, but its all-or-nothing approach requires the entire file in memory, making it unsuitable for modern audio applications. `streaming-wav-decoder` is built to overcome this limitation.

It decodes WAV audio **on the fly, in chunks**, enabling advanced, memory-efficient audio workflows that were previously out of reach in the browser.

---

### 🔊 Live Demo

Coming soon — [demo link placeholder](https://your-demo-url.com)

---

### 🤔 Why Not `decodeAudioData`?

* Requires full download of audio file before decoding begins
* Consumes large memory for long or high-resolution files
* Cannot operate on live streams, blobs, or real-time sources
* Incompatible with `AudioWorklet`-style low-latency workflows

---

### ✅ Key Features

* **Streaming-First API**: Decode audio as bytes arrive from a network stream, file, or any other source
* **Comprehensive Format Support**: PCM (8–32 bit), IEEE Float (32/64), A-Law, µ-Law
* **Truly Isomorphic**: Works in browsers, Node.js, Web Workers, AudioWorklets
* **Zero Dependencies**: Fully standalone, modern TypeScript, tree-shakable
* **Endian-Safe**: Supports both `RIFF` (LE) and `RIFX` (BE) formats
* **Real-Time Aligned Mode**: `decodeAligned()` bypasses buffering for ultra-low latency
* **Battle-Tested**: Fuzzed, 100% test coverage, hardened with golden test sets

---

### 🛆 Installation

```bash
# pnpm
pnpm add streaming-wav-decoder

# npm
npm install streaming-wav-decoder

# yarn
yarn add streaming-wav-decoder
```

---

### 📘 Quick Start: Streaming a File

This example shows how to progressively decode a WAV file fetched from a URL.

```ts
import { WavDecoder } from 'streaming-wav-decoder';

async function decodeAudioStream(url: string) {
  const decoder = new WavDecoder();
  const response = await fetch(url);
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const { channelData, samplesDecoded } = decoder.decode(value);

    if (samplesDecoded > 0) {
      processAudio(channelData);
    }
  }

  const flushed = await decoder.flush();
  if (flushed) {
    processAudio(flushed.channelData);
  }

  console.log('Decoding complete!', decoder.info);
}
```

---

### 🔬 API Guide: The Right Tool for the Job

The decoder provides two distinct decoding methods, designed for different use cases. Choose the one that best fits your needs.

#### `decode(chunk: Uint8Array)`

* **Best for**: General-purpose streaming from files or network requests
* **Behavior**: Parses WAV header, buffers unaligned data safely
* **Notes**: Use this for most use cases — it's robust and handles malformed input

#### `decodeAligned(block: Uint8Array)`

* **Best for**: AudioWorklets, DSP engines, real-time byte-accurate pipelines
* **Requirement**: Input must be block-aligned: `block.length % decoder.info.format.blockAlign === 0`
* **Behavior**: Skips buffering for optimal performance — ideal for hot paths

#### Other Core Methods & Properties

* `new WavDecoder()`: Creates a decoder instance
* `flush()`: Flushes remaining buffer at the end of a stream
* `reset()` / `free()`: Resets state for decoding a new file
* `info`: Exposes stream metadata: sample rate, format, channels, block alignment, etc.

---

### 🚀 Performance: The "Fast Path" Explained

| Method            | Best For          | Internal Overhead                                     |
|-------------------|-------------------|-------------------------------------------------------|
| `decode()`        | General Streaming | Manages internal buffer, handles unaligned chunks     |
| `decodeAligned()` | Real-time / DSP   | **Bypasses buffer**, block-aligned, ultra-low-latency |

**Benchmark Results:**
In real-time decoding tests across Chrome, Firefox, and Safari, `decodeAligned()` reduces CPU time by **up to 30%** vs the buffered version. Use it when every millisecond matters.

---

### 🧭 Roadmap

* ✔️ **v1.0: Core Decoder**

  * Streaming chunk-based decoding
  * Accurate WAV format parsing
  * Complete test suite

* ⏳ **v1.1: Debugging + Diagnostics**

  * Detailed error messages
  * Recovery heuristics
  * Mutation testing integration

* 🚀 **v2.0: Metadata Support**

  * Parse `LIST`, `INFO`, `bext`, `cue `, and markers
  * Expose tags via `info.tags`

---

### 🧺 License

Licensed under the [MIT License](./LICENSE).
See [opensource.org/licenses/MIT](https://opensource.org/licenses/MIT) for full text.
