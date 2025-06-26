# @dekzer/wav-stream-decoder

[//]: # ([![Build Status]&#40;https://github.com/dekzer-oss/wav-stream-decoder/actions/workflows/release.yml/badge.svg&#41;]&#40;https://github.com/dekzer/wav-stream-decoder/actions/workflows/release.yml&#41;)
[//]: # ([![npm version]&#40;https://img.shields.io/npm/v/@dekzer/wav-stream-decoder.svg&#41;]&#40;https://www.npmjs.com/package/@dekzer/wav-stream-decoder&#41;)
[//]: # ([![MIT License]&#40;https://img.shields.io/npm/l/@dekzer/wav-stream-decoder.svg&#41;]&#40;https://github.com/dekzer/wav-stream-decoder/blob/main/LICENSE&#41;)

A robust, dependency-free, streaming WAV audio decoder for any JavaScript environment.

---

### Why use this library?

The web platform has a powerful native `AudioContext.decodeAudioData()`, but it has one major limitation: it requires the entire audio file to be loaded into memory at once. This is unsuitable for applications dealing with large files or real-time audio streams.

`@dekzer/wav-stream-decoder` solves this problem by providing a robust, chunk-based decoding API that works just as well in Node.js as it does in the browser. It is written in pure TypeScript with zero dependencies, ensuring it is lightweight and easy to integrate into any project.

### Features

- **Streaming by Design:** Process audio in chunks, perfect for live streams or large files.
- **Comprehensive Format Support:**
  - **PCM (Integer):** 8, 16, 24, and 32-bit.
  - **IEEE Float:** 32 and 64-bit.
  - **Companded:** A-Law and µ-Law.
- **Full Endianness Support:** Correctly handles both Little-Endian (`RIFF`) and Big-Endian (`RIFX`) files.
- **Isomorphic:** Runs seamlessly in both Node.js and modern browsers.
- **Zero Dependencies:** Pure TypeScript with no external dependencies to worry about.
- **Thoroughly Tested:** Full API test coverage against a comprehensive suite of generated WAV files.

### Installation

```bash
# pnpm
pnpm add @dekzer/wav-stream-decoder

# npm
npm install @dekzer/wav-stream-decoder

# yarn
yarn add @dekzer/wav-stream-decoder
```

### Usage

The decoder is designed to be fed chunks of data as they become available.

#### 1\. Streaming Decode (Recommended)

This is the library's primary strength. It allows you to feed chunks of data of _any size_ as they arrive from any source (e.g., a network request, file stream, or WebSocket). The `decode()` method intelligently handles header parsing and audio frame processing.

```typescript
import { WavStreamDecoder } from '@dekzer/wav-stream-decoder';

async function streamDecode(url: string) {
  const decoder = new WavStreamDecoder();
  const response = await fetch(url);
  const reader = response.body!.getReader();

  while (true) {
    const { done, value } = await reader.read(); // `value` is a Uint8Array of arbitrary size
    if (done) break;

    // Feed each chunk to the decoder.
    const result = decoder.decode(value);

    // The decoder will only produce samples when it has enough
    // data to form complete audio frames.
    if (result.samplesDecoded > 0) {
      console.log(`Decoded ${result.samplesDecoded} new samples.`);
      // ... process result.channelData ...
    }
  }

  // After the stream ends, flush any remaining data
  const finalResult = await decoder.flush();
  if (finalResult) {
    console.log(`Flushed ${finalResult.samplesDecoded} final samples.`);
  }

  console.log('Stream finished.');
}

streamDecode('https://path/to/large/audio.wav');
```

#### 2\. Simple Usage (Decoding a Complete Buffer)

If you already have the entire file in a single buffer, you can still use the `decode()` method. This is simply a special case of streaming where the first and only chunk is the whole file.

```typescript
import { WavStreamDecoder } from '@dekzer/wav-stream-decoder';
import fs from 'fs/promises';

// In Node.js
const fileBuffer = await fs.readFile('path/to/your/audio.wav');

const decoder = new WavStreamDecoder();
const result = decoder.decode(fileBuffer);

if (result.errors.length > 0) {
  console.error('Decoding failed:', result.errors);
} else {
  console.log('Decoded audio successfully!');
  console.log('Sample Rate:', result.sampleRate);
  console.log('Channels:', result.channelData.length);
  console.log('Samples per channel:', result.channelData[0].length);
}
```

### API

- `new WavStreamDecoder()`: Creates a new decoder instance.
- `decoder.decode(chunk: Uint8Array): DecodedAudio`: Feeds a chunk of data. It will parse the header on first calls and decode audio frames on subsequent calls. This is the primary, high-level method.
- `decoder.decodeFrame(frameData: Uint8Array): DecodedAudio`: A low-level method to decode data that is an exact multiple of the frame size (`blockAlign`). Requires the header to be parsed first.
- `decoder.flush(): Promise<DecodedAudio | null>`: Processes any remaining bytes in the internal buffer.
- `decoder.free()`: Resets the decoder and releases resources.
- `decoder.info` (getter): Returns an object with the current `state`, parsed `format`, `errors`, and other info.

---

### Roadmap

#### ✅ **Version 1.0 (Completed)** - _Core Functionality & Robustness_

This version establishes a production-ready, thoroughly tested foundation for the decoder.

- **Core Feature:** High-performance streaming audio decoding.
- **Comprehensive Format Support:**
  - **PCM (Integer):** 8, 16, 24, and 32-bit.
  - **IEEE Float:** 32 and 64-bit.
  - **Companded:** A-Law and µ-Law.
- **Full Endianness Support:** Correctly handles both Little-Endian (`RIFF`) and Big-Endian (`RIFX`) files.
- **Isomorphic Design:** Runs seamlessly in both Node.js and modern browsers.
- **Rigorous Testing:**
  - Complete public API test coverage (`decode`, `decodeFrame`, `flush`, `free`).
  - "Golden File" testing against a comprehensive suite of generated WAV files to ensure correctness.

#### ⏳ **Version 1.1 (Upcoming)** - _Hardening & Resilience_

This release will focus on making the decoder even more resilient to real-world, imperfect files.

- **Graceful Error Handling:** Implement robust checks for common file corruption issues.
  - Invalid or missing `fmt` chunk.
  - Header values that are out of logical bounds (e.g., zero channels).
  - Chunk sizes that exceed the file size.
- **Mutation Testing:** Create a dedicated test suite that programmatically corrupts valid files to ensure the decoder fails predictably without crashing the host application.
- **Improved Error Messages:** Provide more specific and helpful error messages to aid developer debugging.

#### 🚀 **Version 2.0 (Future)** - _Metadata Support_

This major version will introduce the ability to parse common metadata chunks, making the library more useful for professional audio applications.

- **Parse `LIST`/`INFO` Chunks:** Extract standard metadata such as `IART` (Artist), `INAM` (Title), `ICOP` (Copyright), etc.
- **Parse `bext` (Broadcast Wave Extension) Chunks:** Support for the BWF metadata format, which is standard in broadcasting and professional audio.
- **Extensible Metadata API:** Design a clean and accessible way for users to retrieve parsed metadata via the `info` getter.
- **(Potential) Parse `cue ` Chunks:** Add support for cue points, which are markers within the audio data.

---

### License

[MIT](https://www.google.com/search?q=./LICENSE)
