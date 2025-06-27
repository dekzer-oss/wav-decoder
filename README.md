# 🎧 @dekzer/wav-decoder

A robust, streaming-capable WAV audio decoder with full PCM and float support — zero dependencies, works anywhere JavaScript runs.

[![npm version](https://img.shields.io/npm/v/@dekzer/wav-decoder.svg)](https://www.npmjs.com/package/@dekzer/wav-decoder)
[![Build Status](https://img.shields.io/github/actions/workflow/status/dekzer-oss/wav-decoder/main.yml?branch=main)](https://github.com/dekzer-oss/wav-decoder/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

### The Modern Solution for Browser-Based Audio

Native decoding via `AudioContext.decodeAudioData` is powerful, but its all-or-nothing approach requires the entire file in memory, making it unsuitable for modern audio applications. `@dekzer/wav-decoder` is built to overcome this limitation.

It decodes WAV audio **on the fly, in chunks**, enabling advanced, memory-efficient audio workflows that were previously out of reach in the browser.

### Key Features

*   ✅ **Streaming-First API**: Decode audio as bytes arrive from a network stream, file, or any other source.
*   ✅ **Comprehensive Format Support**: Handles PCM (8, 16, 24, 32-bit), IEEE Float (32, 64-bit), A-Law, and µ-Law.
*   ✅ **Truly Isomorphic**: Runs identically in Node.js, browsers, Web Workers, and even real-time `AudioWorklets`.
*   ✅ **Zero Dependencies**: Lightweight, tree-shakable, and written in modern TypeScript with no external dependencies.
*   ✅ **Endianness-Safe**: Natively supports both `RIFF` (little-endian) and `RIFX` (big-endian) file formats.
*   ✅ **High-Performance Aligned API**: Includes a specialized `decodeAligned()` method for real-time DSP pipelines where every microsecond counts.
*   ✅ **Battle-Tested**: Hardened via fuzzing, a comprehensive golden test set, and 100% test coverage.

---

### 📦 Installation

```bash
# pnpm (recommended)
pnpm add @dekzer/wav-decoder

# npm
npm install @dekzer/wav-decoder

# yarn
yarn add @dekzer/wav-decoder
```

---

### 📘 Quick Start: Streaming a File

This example shows how to progressively decode a WAV file fetched from a URL.

```ts
import { WavDecoder } from '@dekzer/wav-decoder';

async function decodeAudioStream(url: string) {
  // 1. Create a new decoder instance.
  const decoder = new WavDecoder();
  const response = await fetch(url);
  const reader = response.body!.getReader();

  // 2. Feed chunks to the robust `decode()` method.
  // It will automatically parse the header and handle unaligned data.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const { channelData, samplesDecoded } = decoder.decode(value);
    
    if (samplesDecoded > 0) {
      // Audio data is available! Route it to your application.
      // e.g., postMessage to an AudioWorklet or render a waveform.
      processAudio(channelData);
    }
  }

  // 3. At the end of the stream, flush the decoder's internal buffer.
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
The primary, robust method for streaming.

*   **Best for**: General-purpose streaming from files or network requests.
*   **How it works**: Automatically parses the WAV header from the initial chunks. Manages an internal buffer to handle arbitrarily sized or unaligned chunks of data, ensuring no data is lost.
*   **Use this method unless you have a specific, high-performance reason not to.**

#### `decodeAligned(block: Uint8Array)`
The specialized, high-performance method for real-time applications.

*   **Best for**: AudioWorklets, custom DSP graphs, or any scenario where you are managing your own buffers and need the lowest possible latency.
*   **Requirement**: The provided `block` of data **must** be perfectly aligned. Its length must be a multiple of `decoder.info.format.blockAlign`.
*   **How it works**: Skips the internal buffer and processes the data directly. This "fast path" offers a performance advantage in tight loops.

#### Other Core Methods & Properties

*   `new WavDecoder()`: Creates a new, reusable decoder instance.
*   `flush()`: Flushes the internal buffer to process any leftover bytes at the end of a stream.
*   `reset()`: Resets the decoder to its initial state, ready to process a new file.
*   `free()`: An alias for `reset()` that clears all internal state.
*   `info`: A getter that returns an object with detailed information about the WAV file (`format`, `sampleRate`, `channels`, progress, etc.).

---

### 🚀 Performance: The "Fast Path" Explained

The dual API is designed to let you choose between robustness and raw speed.

| Method | Best For | Internal Overhead |
| :--- | :--- | :--- |
| `decode()` | General Streaming | Manages an internal buffer to handle unaligned data. |
| `decodeAligned()`| Real-time / DSP | **Bypasses the internal buffer**, processing data directly. |

Benchmarks confirm this design. When used in a tight loop, `decodeAligned()` is **measurably faster** across all major browsers (Chrome, Firefox, and WebKit). The performance gain is most significant in highly-optimized engines like V8 (Chromium), where it can reduce execution time by **up to 30%** in looping scenarios.

**Conclusion:** Choose `decode()` for simplicity and robustness. Choose `decodeAligned()` when every microsecond matters.

---

### 🧭 Roadmap

*   [**✅ v1.0: Core Decoder**]
    *   Chunk-based `decode` and `decodeAligned` APIs.
    *   Precise header parsing for all supported formats.
    *   Coverage-driven test suite.

*   [**⏳ v1.1: Resilience & Debugging**]
    *   Detailed error diagnostics and recovery options.
    *   Mutation testing to ensure parser stability.

*   [**🚀 v2.0: Metadata & Tagging**]
    *   `LIST` and `INFO` chunk parsing for tags like artist and title.
    *   Broadcast WAV Extension (`bext`) chunk support.
    *   Cue points (`cue `) and markers.
    *   Exposed metadata via a new `info.tags` property.

---

### 🪪 License

MIT — [See LICENSE](./LICENSE)
