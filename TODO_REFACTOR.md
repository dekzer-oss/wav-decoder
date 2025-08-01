# 🏗️ **Dekzer WAV Decoder Refactor Blueprint (ALL-IN-ONE)**

## **Goal**

Bring together:

* The proven, pure `parseWavHeader` function
* Modern streaming buffer design for both header & audio
* *All* useful abstractions: `StateManager`, `ErrorFactory`, `AudioBufferPool`, etc.
* **No** performance regressions, but maintain testability and maintainability

---

## **Big Picture Architecture**

```mermaid
graph TD
    Decode[.decode(chunk)]
    HB[headerBuffer (Uint8Array or StreamBuffer)]
    PH[parseWavHeader]
    SM[StateManager]
    EF[ErrorFactory]
    SB[streamBuffer (StreamBuffer)]
    AP[AudioBufferPool]
    DA[decode audio frames]
    Errors[Errors/Warnings]

    Decode --> HB
    HB --> PH
    PH --> SM
    PH --> EF
    PH --> SB
    SB --> DA
    DA --> AP
    SM --> Errors
    EF --> Errors
```

---

## **Class Members to Keep**

```ts
private readonly stateManager = new StateManager();
private readonly errorFactory = new ErrorFactory(this.stateManager);
private readonly audioBufferPool = new AudioBufferPool();
private readonly streamBuffer: StreamBuffer;
private headerBuffer: Uint8Array; // or StreamBuffer if you want

constructor(options: DecoderOptions = {}) {
    // Choose sizes sensibly
    this.streamBuffer = new StreamBuffer(options.maxBufferSize ?? 16*1024*1024);
    this.headerBuffer = new Uint8Array(0);
}
```

* **Drop:** Any `riffParser`, `FormatParser`, or `tryParseHeader` function/class.

---

## **Header Buffer Pattern**

* Accumulate all bytes until header is parsed:

    * **Choice:** Use either a plain `Uint8Array` (with manual concat) or a `StreamBuffer` for header only (the latter is a bit overkill unless you want peek/discard APIs).
    * *Pragmatic advice:* A plain `Uint8Array` is usually fastest for header, since header parse is a one-off operation.

---

## **`parseWavHeader` Integration**

* Call after every append to `headerBuffer` until you get a result with `.format`.
* Don't move to decoding until parse is successful!
* **On success:**

    * Copy/init all relevant format fields to `StateManager`
    * Extract *all* `data` chunks from header and push them into `streamBuffer` for decoding
    * Clear the header buffer and transition state

---

## **Data Flow: Chunk Handling**

* **In `.decode(chunk)`**:

    * If still parsing header: append to `headerBuffer`, call `parseWavHeader`, and on success, move state
    * If parsing succeeded and there's remaining data in this chunk, push remainder to `streamBuffer`
    * From then on, all incoming data goes to `streamBuffer` and is processed by your decode hot path

---

## **State/Progress Tracking**

* *All* state transitions (`IDLE` → `DECODING` → `ENDED`/`ERROR`) and metadata (format, bytes, samples) are managed via `StateManager`.
* Query `.info` or equivalent for debug/progress in API and tests.

---

## **Error/Warning Handling**

* **On header parse:** Forward all errors/warnings from `parseWavHeader` into `ErrorFactory`, and ensure they're available from `.info`/`.decode()` results.
* **On audio decode:** All runtime/streaming errors should also go through `ErrorFactory` so that they are visible in `StateManager` and public results.

---

## **AudioBufferPool Usage**

* Whenever you need a `Float32Array[]` for decoded channel data, always acquire from `audioBufferPool.get(channels, samples)`.
* Release/recycle as soon as safe to prevent leaks.
* Avoid `new Float32Array(...)` in decode hot path as much as possible.

---

## **StreamBuffer Usage**

* Your main `streamBuffer` holds all audio data (post-header).
* All reads/peeks/discards for decoding audio frames happen here.
* Expose `available`, `peekContiguous`, `read`, `discard` as needed.

---

## **Flush/Reset/Free**

* `flush()`: Process any trailing bytes, finalize state, and release resources (return all buffers to pool, clear streamBuffer).
* `reset()`: Bring decoder to pristine state (all buffers, state, and errors cleared, ready for a new file).
* `free()`: Release *all* buffers, including any held in pools, for GC (for explicit resource release in apps).

---

## **After-Parse Data Handling**

* After parsing header and extracting all "data" chunk bytes into `streamBuffer`, always start all frame decoding from `streamBuffer` in fixed-size chunks (`blockAlign`).
* If there's partial data at the end, hold until more arrives or stream ends.

---

## **Remove Redundant Code**

* **Delete:**

    * All legacy parser classes (`RiffParser`, `FormatParser`, etc.)
    * Any old header parse state/methods (`tryParseHeader`, `headerBufferStream`)
    * Any custom error handling not routed via `ErrorFactory`
    * Old progress fields not handled via `StateManager`

---

## **Test and Validate**

* **Test Cases:**

    * Partial/incremental headers (simulate streaming)
    * Weird/funky chunk layouts, out-of-order chunks, multiple "data" chunks, etc.
    * Truncated files and incomplete frames
    * Decoder error propagation
    * Buffer reuse with pool (no leaks!)

---

## **Header-Parse Example (In .decode())**

```ts
if (this.stateManager.state === DecoderState.IDLE) {
    // Grow the headerBuffer
    const combined = new Uint8Array(this.headerBuffer.length + chunk.length);
    combined.set(this.headerBuffer, 0);
    combined.set(chunk, this.headerBuffer.length);
    this.headerBuffer = combined;

    // Try parsing header
    const result = parseWavHeader(this.headerBuffer);
    if (result.errors.length > 0) {
        // Forward errors
        this.errorFactory.create(...result.errors);
        return this.createEmptyResult();
    }
    if (result.format) {
        // Initialize state
        this.stateManager.initialize(result.format, result.dataBytes, ...);
        this.stateManager.setParsedChunks(result.parsedChunks, result.unhandledChunks);

        // Move all "data" chunk bytes to streamBuffer for decoding
        for (const dataChunk of result.dataChunks) {
            const start = dataChunk.offset;
            const end = start + dataChunk.size;
            const chunkData = this.headerBuffer.subarray(start, end);
            if (chunkData.length > 0) this.streamBuffer.append(chunkData);
        }

        this.headerBuffer = new Uint8Array(0);
        this.stateManager.setState(DecoderState.DECODING);

        // If any remainder of incoming chunk not used, push to streamBuffer
        // ... (optional)
    }
    // fall through to processBufferedBlocks()
}
```

---

## **Refactor Steps: High-Level TODO**

1. **Remove all class-based header/RIFF parsing.**
2. **Replace with:**

    * `headerBuffer` + `parseWavHeader()`
3. **Integrate** abstractions: `StateManager`, `ErrorFactory`, `AudioBufferPool`, `StreamBuffer`
4. **Route all state, error, progress logic** via those abstractions
5. **Ensure all after-header audio chunks go through `streamBuffer`**
6. **Test thoroughly**—incremental parse, edge cases, errors, pooling

---

## **Notes/Tradeoffs**

* Using a class for the header parser is not needed, and is less robust in streaming/incremental use cases. A *pure function* is easier to reason about, test, and refactor.
* `headerBuffer` as a `Uint8Array` is more efficient for the typical <2KB headers, but if you want a unified API everywhere, `StreamBuffer` is fine too (with a tiny cost).
* Do **NOT** reintroduce perf regressions by over-abstracting hot-path code (especially around audio frame decode or memory management).

---

## **Ready to Build**

* This is your "rebase point" for the next session.
* All code and abstractions are now designed to be *easy to test*, *maintain*, and *profile for performance*.

---

# 📂 New File Tree (Recommended Layout)

**(This is an evolution of your existing structure—abstract, clean, modular)**

```
.
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tsup.config.ts
│
├── src
│   ├── index.ts                     # Public entry point (exports WavDecoder, types, etc.)
│   │
│   ├── WavDecoder.ts                # Main streaming decoder class
│   ├── parseWavHeader.ts            # Pure, stateless header parser function
│   ├── types.ts                     # All shared types/interfaces/enums
│   │
│   ├── StateManager.ts              # Decoder state/progress/error abstraction
│   ├── ErrorFactory.ts              # Central error/warning object creator
│   │
│   ├── buffer
│   │   ├── RingBuffer.ts
│   │   └── StreamBuffer.ts
│   │
│   ├── pool
│   │   └── AudioBufferPool.ts       # Float32Array channel buffer pooling
│   │
│   ├── decode-fns                   # All hot-path decode routines
│   │   ├── decodePCM8.ts
│   │   ├── decodePCM16.ts
│   │   ├── decodePCM24.ts
│   │   ├── decodePCM32.ts
│   │   ├── decodeFloat32.ts
│   │   ├── decodeFloat64.ts
│   │   ├── decodeALaw.ts
│   │   ├── decodeMuLaw.ts
│   │   └── decodeIMAADPCM.ts
│   │
│   └── constants.ts                 # Format tags, lookup tables, etc.
│
├── tests
│   ├── WavDecoder.test.ts
│   ├── parseWavHeader.test.ts
│   ├── RingBuffer.test.ts
│   ├── fixtures
│   │   ├── helpers.ts
│   │   ├── wav/...
│   │
│   └── __snapshots__                # (optional, for Vitest inline snapshots)
│
├── bench
│   └── (benchmarking scripts/results)
│
├── public
│   └── (demo files, sample WAVs, HTML, favicon, etc.)
│
└── scripts
    └── gen-wav-fixtures.py
```

> **You can adapt folder names as you like (`buffer/`, `pool/`, `decode-fns/`), but this layout maximizes modularity, maintainability, and performance.**

---

# 🟢 **API Design for @dekzer/wav-decoder**

A **simple, robust streaming decode API** that is *friendly for both Node and browser usage*.

---

## **Public Exports**

```ts
// index.ts

export { WavDecoder } from './WavDecoder';
export { parseWavHeader } from './parseWavHeader';
export * from './types';
```

---

## **WavDecoder Class** (Core API)

```ts
class WavDecoder {
  constructor(options?: DecoderOptions);

  // Core streaming API
  decode(chunk: Uint8Array): DecodedWavAudio;  // Feed in streaming chunks (partial or full)
  flush(): DecodedWavAudio;                    // End-of-stream, flush leftovers

  // State and info
  get info(): WavDecoderInfo;                  // { format, state, decodedBytes, progress, errors, ... }
  get progress(): number;                      // 0..1 (fraction of file/stream decoded)
  get totalDuration(): number;                 // In seconds
  get totalFrames(): number;                   // Frame count

  // Control
  reset(): void;                              // Soft-reset for reuse
  free(): void;                               // Release all buffers/resources

  // (Optional) Frame-level decode for advanced use
  decodeFrame(frame: Uint8Array): Float32Array | null;
  decodeFrames(frames: Uint8Array[]): DecodedWavAudio;

  // (Optional) Async streaming interface
  stream(input: ReadableStream<Uint8Array>): AsyncIterableIterator<DecodedWavAudio>;

  // (Optional static)
  static supports(formatTag: number): boolean;
}
```

---

## **Types (in `types.ts`)**

```ts
export interface DecoderOptions {
  maxBufferSize?: number;      // Main audio ring buffer size (bytes)
  maxHeaderSize?: number;      // Max allowed header size (bytes)
}

export enum DecoderState { IDLE, DECODING, ENDED, ERROR }

export interface WavDecoderInfo {
  format: ExtendedWavFormat;
  state: DecoderState;
  decodedBytes: number;
  totalBytes: number;
  progress: number;
  errors: DecodeError[];
  totalFrames: number;
  totalDuration: number;
  parsedChunks: DataChunk[];
  unhandledChunks: DataChunk[];
}

export interface ExtendedWavFormat {
  // All parsed fmt info (channels, sampleRate, bitDepth, formatTag, blockAlign, etc.)
}

export interface DecodedWavAudio {
  bitsPerSample: number;
  channelData: Float32Array[];
  sampleRate: number;
  samplesDecoded: number;
  errors: DecodeError[];
}

export interface DecodeError {
  message: string;
  frameNumber?: number;
  inputBytes?: number;
  outputSamples?: number;
  [k: string]: any;
}
```

---

## **parseWavHeader Function**

```ts
export function parseWavHeader(
  buffer: Uint8Array
): {
  format?: ExtendedWavFormat;
  dataChunks: DataChunk[];
  parsedChunks: DataChunk[];
  unhandledChunks: DataChunk[];
  dataBytes: number;
  errors: string[];
  warnings: string[];
  isLittleEndian: boolean;
};
```

*This function is pure/stateless: call it repeatedly with an accumulating header buffer.*

---

# 🟢 **Best Practices & Notes**

* **All errors/warnings** propagate via `ErrorFactory` + `StateManager`.
* **No legacy RIFF/Format parser classes**: Only the robust, pure `parseWavHeader()` for header parsing.
* **Incremental buffer**: Use `headerBuffer` until state is DECODING, then everything goes into `streamBuffer`.
* **No header parse methods left on WavDecoder**; the stateful stuff is all gone.
* **Test streaming and edge cases.**
* **Abstractions** (`StateManager`, `AudioBufferPool`, etc.) should be reusable and decoupled.

---

## Example Usage

```ts
import { WavDecoder } from '@dekzer/wav-decoder';

const decoder = new WavDecoder();
for (const chunk of streamChunks) {
  const result = decoder.decode(chunk);
  // Use result.channelData, result.errors, etc.
}
const final = decoder.flush();
```

---

## TL;DR

**Stateless, streaming, incremental, robust, testable, and easy to maintain.**

---

Absolutely, let's extend and lock in all the **TransformStream/pipeline ideas** and utilities, *plus* the Node/batch use-cases. Here's a thorough, living TODO/blueprint section you can just append to your `.md` file.

---

# 🟢 **Dekzer Streaming & Pipeline Patterns**

## **Modern Streaming APIs (TransformStreams & Async Iterators)**

### 1. **Streaming Decode as TransformStream**

**Purpose:**
Let any source (fetch, fs, mic, user upload) *stream* `Uint8Array` chunks through decoding—works in browser, Node, workers.

```ts
export function wavDecodeTransform(decoder = new WavDecoder()) {
  return new TransformStream<Uint8Array, DecodedWavAudio>({
    transform(chunk, ctrl) {
      ctrl.enqueue(decoder.decode(chunk));
    },
    flush(ctrl) {
      ctrl.enqueue(decoder.flush());
    }
  });
}
```

---

### 2. **Composable Audio Processing Pipelines**

* You can pipe through **arbitrary stages**:

    * *Loudness/peak metering*
    * *FX (gain, EQ, silence trim)*
    * *Metadata extraction*
    * *ML/AI features (beat, pitch, etc)*
    * *Real-time visualizations*
* **Pattern:**

  ```ts
  .pipeThrough(wavDecodeTransform())
  .pipeThrough(myLoudnessTransform)
  .pipeThrough(anotherFxTransform)
  ```

---

### 3. **Async Iterable (for-await) Helpers**

* For environments that prefer async iterables:

  ```ts
  for await (const decoded of readableStream
      .pipeThrough(wavDecodeTransform())
      .getReader()) {
    // decoded: DecodedWavAudio
  }
  ```

* **You can add:**

  ```ts
  public async *stream(input: ReadableStream<Uint8Array>): AsyncIterableIterator<DecodedWavAudio> {
    this.reset();
    const reader = input.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          yield this.flush();
          break;
        }
        yield this.decode(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  ```

---

### 4. **Node.js/Bulk File Utilities**

* **`decodeFile(buffer: Uint8Array): DecodedWavAudio`**

    * Fastest for Node (entire file in memory)
    * Calls parseWavHeader, then bulk frame decode.
    * Returns one big DecodedWavAudio.

* **`decodeFileStream(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<DecodedWavAudio>`**

    * For Node streams, files, or browser FileReader.

---

### 5. **Pipeline Utility Generators (for Plugins)**

* **Factory for audio processing transforms:**

  ```ts
  export function createAudioTransform(processFn: (audio: DecodedWavAudio) => DecodedWavAudio) {
    return new TransformStream<DecodedWavAudio, DecodedWavAudio>({
      transform(audio, ctrl) {
        ctrl.enqueue(processFn(audio));
      }
    });
  }
  ```

* **Example:**

  ```ts
  const gainTransform = createAudioTransform(audio => {
    for (const chan of audio.channelData) for (let i = 0; i < chan.length; i++) chan[i] *= 0.5;
    return audio;
  });
  ```

---

### 6. **Document/Export All of the Above**

* Expose these as top-level exports in your package:

  ```ts
  export { wavDecodeTransform, createAudioTransform };
  ```
* In README and doc comments, **show** users *how to build streaming pipelines* and combine with WebAudio or Node streams.

---

## 🏁 **Checklist for Streaming Integration**

* [ ] **Export `wavDecodeTransform()`** for native streaming decode.
* [ ] **Export `createAudioTransform()`** for custom FX/plugins.
* [ ] **Add `decodeFile()` and/or `decodeFileStream()`** for batch/Node-style usage.
* [ ] **Document** all patterns: browser, Node, async iterators, plugin transforms.
* [ ] **Test:** chained pipelines, backpressure, memory use.

---

## 🚩 **Example: Full Streaming Decode Pipeline**

```ts
import { wavDecodeTransform, createAudioTransform } from '@dekzer/wav-decoder';

const loudnessTransform = createAudioTransform(audio => {
  audio.loudness = measureLoudness(audio.channelData);
  return audio;
});

const response = await fetch('/track.wav');
const decodedStream = response.body!
  .pipeThrough(wavDecodeTransform())
  .pipeThrough(loudnessTransform);

for await (const decoded of decodedStream.getReader()) {
  // Process or play PCM audio blocks in real time!
}
```

---

## **Design Notes / Best Practices**

* **Prefer streaming APIs** for large files and real-time use cases.
* **Composable transforms** keep code clean, testable, and flexible.
* **Document common plugin patterns** (gain, peak/loudness, ML, etc).
* **Async iterable helpers** are ideal for modern codebases—no callbacks!
* **Node and browser compatibility**: design utilities that work in both worlds.

---

## 📋 **Appendix: Standard Transform Utilities**

* `wavDecodeTransform(decoder?: WavDecoder): TransformStream<Uint8Array, DecodedWavAudio>`
* `createAudioTransform(fn: (DecodedWavAudio) => DecodedWavAudio): TransformStream<DecodedWavAudio, DecodedWavAudio>`
* `decodeFile(buffer: Uint8Array): DecodedWavAudio`
* `decodeFileStream(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<DecodedWavAudio>`

---

## 🎯 **Add These Items to Your File Tree**

```
src/
  stream/
    wavDecodeTransform.ts
    createAudioTransform.ts
    ...
  node/
    decodeFile.ts
    decodeFileStream.ts
```
