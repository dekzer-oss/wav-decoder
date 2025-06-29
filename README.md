# @dekzer/wav-decoder

A streaming WAV decoder for TypeScript/JavaScript with support for large files and real-time processing.

[![npm version](https://img.shields.io/npm/v/@dekzer/wav-decoder.svg)](https://www.npmjs.com/package/@dekzer/wav-decoder)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why This Library?

The Web Audio API's `decodeAudioData()` requires the entire audio file to be loaded into memory before decoding can begin. This creates problems when working with large WAV files or streaming audio data.

This library allows you to decode WAV audio progressively as data arrives, enabling:
- Instant playback of large files (1GB+)
- Streaming from network sources
- Lower memory usage
- Real-time audio processing

## Installation

```bash
# pnpm
pnpm add @dekzer/wav-decoder

# npm
npm install @dekzer/wav-decoder

# yarn
yarn add @dekzer/wav-decoder
```

## Basic Usage

```typescript
import { WaveDecoder } from '@dekzer/wav-decoder';

async function streamAudio(url: string) {
  const decoder = new WaveDecoder();
  const response = await fetch(url);
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const result = decoder.decode(value);
    if (result.samplesDecoded > 0) {
      // Process audio data immediately
      playAudio(result.channelData);
    }
  }

  // Process any remaining data
  const final = decoder.flush();
  if (final) {
    playAudio(final.channelData);
  }
}
```

## API

### `new WaveDecoder()`
Creates a new decoder instance.

### `decode(chunk: Uint8Array)`
Decodes a chunk of WAV data. Returns a `DecodedWaveAudio` with:
- `channelData: Float32Array[]` - Decoded audio samplesDecoded by channel
- `samplesDecoded: number` - Number of samplesDecoded decoded from this chunk
- `sampleRate: number` - Sample rate of the audio
- `errors: DecodeError[]` - Any decoding errors encountered

### `decodeFrames(frames: Uint8Array)`
Optimized version for real-time use. Input must be block-aligned (length must be a multiple of `blockAlign`).

### `decodeFrame(frame: Uint8Array)`
Decodes a single audio frame. Highly optimized for performance-critical applications.

### `flush()`
Processes any remaining buffered data. Returns a Promise that resolves to final decoded audio or null.

### `info`
Provides comprehensive decoder information:
- `state: DecoderState` - Current decoder state
- `format: WaveFormat` - Detailed format information including sample rate, channels, bit depth
- `errors: DecodeError[]` - Decoding error history
- `progress: number` - Decoding progress (0-1)
- Plus additional diagnostic information

## Supported Formats

- PCM (8, 16, 24, 32-bit)
- IEEE Float (32, 64-bit)
- A-law and µ-law
- Both little-endian (RIFF) and big-endian (RIFX)
- Extensible WAV formats

## Requirements

- Modern JavaScript environment with TypeScript support
- No dependencies

## License

Licensed under the [MIT License](./LICENSE).
See [opensource.org/licenses/MIT](https://opensource.org/licenses/MIT) for full text.
