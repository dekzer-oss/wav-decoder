# 🎧 wav-stream-decoder

A robust, streaming-capable WAV audio decoder with full PCM and float support — zero dependencies, works anywhere JavaScript runs.

[![npm version](https://img.shields.io/npm/v/wav-stream-decoder.svg)](https://www.npmjs.com/package/wav-stream-decoder)
[![Build Status](https://img.shields.io/github/actions/workflow/status/dekzer-oss/wav-stream-decoder/main.yml?branch=main)](https://github.com/dekzer-oss/wav-stream-decoder/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

### The Modern Solution for Browser-Based Audio

Native decoding via `AudioContext.decodeAudioData` is powerful, but its all-or-nothing approach requires the entire file in memory, making it unsuitable for modern audio applications. `wav-stream-decoder` is built to overcome this limitation.

It decodes WAV audio **on the fly, in chunks**, enabling advanced, memory-efficient audio workflows that were previously out of reach in the browser.

### Key Features

* ✅ **Streaming-First API**: Decode audio as bytes arrive from a network stream, file, or any other source.
* ✅ **Comprehensive Format Support**: Handles PCM (8, 16, 24, 32-bit), IEEE Float (32, 64-bit), A-Law, and µ-Law.
* ✅ **Truly Isomorphic**: Runs identically in Node.js, browsers, Web Workers, and even real-time `AudioWorklets`.
* ✅ **Zero Dependencies**: Lightweight, tree-shakable, and written in modern TypeScript with no external dependencies.
* ✅ **Endianness-Safe**: Natively supports both `RIFF` (little-endian) and `RIFX` (big-endian) file formats.
* ✅ **High-Performance Aligned API**: Includes a specialized `decodeAligned()` method for real-time DSP pipelines where every microsecond counts.
* ✅ **Battle-Tested**: Hardened via fuzzing, a comprehensive golden test set, and 100% test coverage.

---

### 📦 Installation

```bash
# pnpm
pnpm add wav-stream-decoder
````

---

### 📘 Quick Start: Streaming a File

This example shows how to progressively decode a WAV file fetched from a URL.

```ts
import { WavStreamDecoder } from 'wav-stream-decoder';

async function decodeAudioStream(url: string) {
  const decoder = new WavStreamDecoder();
  const response = await fetch(url);
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

* **Best for**: General-purpose streaming from files or network requests.
* **How it works**: Automatically parses the WAV header from the initial chunks. Manages an internal buffer to handle arbitrarily sized or unaligned chunks of data, ensuring no data is lost.
* **Use this method unless you have a specific, high-performance reason not to.**

#### `decodeAligned(block: Uint8Array)`

* **Best for**: AudioWorklets, custom DSP graphs, or any scenario where you are managing your own buffers and need the lowest possible latency.
* **Requirement**: The provided `block` of data **must** be perfectly aligned. Its length must be a multiple of `decoder.info.format.blockAlign`.
* **How it works**: Skips the internal buffer and processes the data directly. This "fast path" offers a performance advantage in tight loops.

#### Other Core Methods & Properties

* `new WavStreamDecoder()`: Creates a new, reusable decoder instance.
* `flush()`: Flushes the internal buffer to process any leftover bytes at the end of a stream.
* `reset()`: Resets the decoder to its initial state, ready to process a new file.
* `free()`: An alias for `reset()` that clears all internal state.
* `info`: A getter that returns an object with detailed information about the WAV file (`format`, `sampleRate`, `channels`, progress, etc.).

---

### 🚀 Performance: The "Fast Path" Explained

| Method            | Best For          | Internal Overhead                                   |
|-------------------|-------------------|-----------------------------------------------------|
| `decode()`        | General Streaming | Manages an internal buffer for unaligned data       |
| `decodeAligned()` | Real-time / DSP   | **Bypasses the internal buffer**, ultra-low-latency |

Benchmarks confirm this design. When used in a tight loop, `decodeAligned()` is **measurably faster** across all major browsers (Chrome, Firefox, WebKit). In Chromium, it reduces execution time by **up to 30%** in real-time decoding scenarios.

**Conclusion:**
Use `decode()` for simplicity and robustness. Use `decodeAligned()` when performance is critical.

---

### 🧭 Roadmap

* \[**✅ v1.0: Core Decoder**]

    * Chunk-based `decode` and `decodeAligned` APIs
    * Precise header parsing for all supported formats
    * Coverage-driven test suite

* \[**⏳ v1.1: Resilience & Debugging**]

    * Detailed error diagnostics and recovery options
    * Mutation testing to ensure parser stability

* \[**🚀 v2.0: Metadata & Tagging**]

    * `LIST` and `INFO` chunk parsing (artist, title, etc.)
    * Broadcast WAV Extension (`bext`) support
    * Cue points (`cue `), markers
    * Metadata exposure via `info.tags`

---

### 🪪 License

This project is licensed under the [MIT License](./LICENSE).  
For more details, see [opensource.org/licenses/MIT](https://opensource.org/licenses/MIT).
