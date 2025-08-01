### 1. Core Concepts and Architecture

The decoder is designed as a state machine that processes a stream of bytes. It doesn't require the entire file to be in memory at once, making it suitable for large files or network streams.

#### **State Management**

The decoder operates in one of several states, tracked by the `private state` property which uses the `DecoderState` enum:

* `DecoderState.IDLE`: The initial state. The decoder is waiting to receive enough data to parse the WAV header.
* `DecoderState.DECODING`: The header has been successfully parsed. The decoder is now processing audio data chunks.
* `DecoderState.ENDED`: The stream has finished, either by calling `flush()` or `free()`. No more data will be processed.
* `DecoderState.ERROR`: A fatal, unrecoverable error has occurred, and the decoder has stopped.

#### **Buffer Strategy**

The class uses several buffers to manage the incoming data stream efficiently:

* `headerBuffer`: A `Uint8Array` that accumulates the initial bytes of the stream. Data is added here until the complete WAV header can be parsed. Once parsed, this buffer is cleared.
* `ringBuffer`: A **Ring Buffer** (or circular buffer) is the core of the streaming implementation. After the header is parsed, all subsequent audio data chunks are written to this buffer. It allows the decoder to read data that might span across the boundaries of incoming chunks without expensive re-allocations. It also decouples the incoming data rate from the decoding processing rate.
* `decodeBuffer` & `scratchPool`: To avoid repeated memory allocations in the decoding loop, the class uses a memory pooling strategy. `decodeBuffer` is a reusable `ArrayBuffer` used to hold a contiguous block of data pulled from the `ringBuffer` before decoding. The `scratchPool` holds onto old buffers so they can be reused later by `getScratchBuffer()`, reducing garbage collection pressure.
* `channelData`: An array of `Float32Array`s, where each `Float32Array` represents a single channel of decoded audio (e.g., `channelData[0]` is the left channel, `channelData[1]` is the right). The final output is stored here.

#### **Error and Warning Handling**

The decoder features a comprehensive error and warning system:

* `currentErrors` and `currentWarnings`: These arrays collect non-fatal issues encountered during a `decode()` call. They are returned to the user with each result and then cleared.
* `_lastError`: Stores the last fatal `Error` object that caused the decoder to move to the `ERROR` state.
* `_errorHistory` and `_warningHistory`: Optional, fixed-size ring buffers that can be enabled in the constructor (`historySize`). They keep a running log of all errors and warnings for debugging purposes, preventing them from being lost after each `decode()` call.

-----

### 2. Initialization and Public API

#### **Constructor**

```typescript
constructor(options: ExtendedDecoderOptions = {}) {
  const bufferSize = options.maxBufferSize ?? WavDecoder.MAX_BUFFER_SIZE;
  this.ringBuffer = new RingBuffer(bufferSize);
  this.decodeBuffer = this.getScratchBuffer(4096);

  const historySize = options.historySize ?? 0;
  if (historySize > 0) {
    this._errorHistory = this.createHistoryBuffer<DecodeError>(historySize);
    this._warningHistory = this.createHistoryBuffer<string>(historySize);
  }
}
```

When a `WavDecoder` is instantiated:

1.  It creates the main `ringBuffer` with a specified or default maximum size.
2.  It pre-allocates an initial `decodeBuffer` from the scratch pool.
3.  If `options.historySize` is provided, it initializes the history buffers for debugging.

#### **Getters**

The class provides several getters for inspecting its state:

* `info`: Returns a snapshot of the decoder's current status, including the parsed `format`, byte counts, state, and any discovered WAV chunks.
* `progress`: A simple `0` to `1` value indicating how much of the file's `data` chunk has been decoded.
* `totalDuration` and `estimatedSamples`: These calculate the audio duration. It intelligently uses the `fact` chunk if present (which gives a precise sample count for compressed formats) or estimates the count from the total data size and block alignment.
* `lastError`, `errorHistory`, `warningHistory`: Provide access to the error and warning logs.

#### **Core Methods**

* **`decode(chunk: Uint8Array): DecodedWavAudio`**
  This is the main entry point for feeding data to the decoder.

    1.  **State Check:** It first checks if the decoder is in a terminal state (`ENDED` or `ERROR`) and returns an error if so.
    2.  **Header Phase (`IDLE` state):** If the decoder is `IDLE`, it appends the incoming `chunk` to the `headerBuffer`. It then calls `tryParseHeader()` to see if it has enough data to understand the WAV file structure. If parsing succeeds, the state changes to `DECODING`.
    3.  **Data Phase (`DECODING` state):** If the decoder is already `DECODING`, it writes the incoming `chunk` directly into the `ringBuffer`.
    4.  **Process Data:** In either case, after new data is added, it calls `processBufferedBlocks()` to decode any complete audio blocks now available in the `ringBuffer`.
    5.  **Return Value:** It returns a `DecodedWavAudio` object containing the newly decoded `channelData`, any errors/warnings from the operation, and the number of samples decoded.

* **`flush(): DecodedWavAudio`**
  This method is called when the input stream has ended. It processes any remaining data in the `ringBuffer`. If the remaining bytes don't form a complete final block, they are discarded, and an error is logged. The decoder state is then set to `ENDED`.

* **`reset()` & `free()`**
  `reset()` returns the decoder to its initial `IDLE` state, ready to process a new file. `free()` does the same but also releases all memory held in the `scratchPool`, effectively cleaning up completely.

-----

### 3. Internal Processing: The Deep Dive

This is where the main logic resides. The process flows from header parsing to block processing to the final sample decoding.

#### **Step 1: Parsing the Header (`tryParseHeader`)**

1.  This method is called repeatedly by `decode()` until it succeeds.
2.  It uses an external utility, `parseWavHeader` (not shown), which reads the RIFF structure of the `headerBuffer`. This utility identifies key chunks like `"fmt "` (format details), `"data"` (audio data location/size), and others like `"fact"` or `"LIST"`.
3.  **Format Resolution:** The parsed information is stored in `this.format`. A critical step here is handling `WAVE_FORMAT_EXTENSIBLE`. If this format is detected, the decoder looks at the `subFormat` GUID to determine the *actual* underlying format (e.g., PCM or IEEE Float) and updates the `resolvedFormatTag` property.
4.  **Validation (`validateFormat`):** The parsed format is then rigorously validated.
    * It checks for sane values (e.g., `sampleRate > 0`).
    * It checks against hardcoded limits (`MAX_CHANNELS`, `MAX_SAMPLE_RATE`).
    * It verifies the `resolvedFormatTag` is one of the supported types (`PCM`, `IEEE_FLOAT`, `A-LAW`, `MU-LAW`, `IMA_ADPCM`).
    * It checks if the `bitsPerSample` is valid for the given format (e.g., PCM can be 8, 16, 24, or 32-bit).
5.  **Alignment Correction (`validateAndFixBlockAlignment`):** A common problem in WAV files is an incorrect `blockAlign` or `bytesPerSecond` value in the header. This method recalculates the expected values based on channels and bit depth and corrects them, adding a warning. This makes the decoder robust against poorly generated files.
6.  **Transition to Decoding:**
    * The total size of all `data` chunks is summed into `totalBytes`.
    * Any audio data that was already in the `headerBuffer` (i.e., immediately following the header) is written to the `ringBuffer`.
    * The `headerBuffer` is cleared.
    * The decoder's state is set to `DecoderState.DECODING`.

#### **Step 2: Processing Buffered Audio (`processBufferedBlocks`)**

1.  This method is called after any new data arrives.
2.  It checks how many complete audio blocks are available in the `ringBuffer` by dividing the available bytes by `this.format.blockAlign`. A **block** (or frame) is the smallest atomic unit of audio data, containing one sample for each channel (e.g., for 16-bit stereo, a block is 4 bytes).
3.  If there's at least one full block, it prepares the data for decoding.
    * **Optimization:** It first attempts to get a direct, contiguous view of the data from the ring buffer using `ringBuffer.peekContiguous()`. If all the blocks to be processed fit in this single view, no copy is needed.
    * **Data Copy:** If the data wraps around the ring buffer's boundary, it copies the two separate segments into the `decodeBuffer` to form a single, contiguous `Uint8Array`.
4.  It calls `decodeInterleavedFrames()` with this contiguous byte array.
5.  After decoding, it discards the processed bytes from the `ringBuffer` using `ringBuffer.discard()` and updates the `decodedBytes` counter.

#### **Step 3: Decoding Frames (`decodeInterleavedFrames` and Dispatchers)**

This is the final and most complex stage, where raw bytes are converted into `Float32Array` samples.

1.  **`decodeInterleavedFrames`** acts as a central dispatcher.

    * It calculates the total number of samples that will be produced. For most formats, this is `bytes / blockAlign`. For IMA ADPCM, it's `(bytes / blockAlign) * samplesPerBlock`.
    * It ensures the `channelData` buffers are large enough.
    * It creates a `DataView` over the input bytes for easy reading of multi-byte numbers.
    * Using a `switch` on `this.format.resolvedFormatTag`, it calls the appropriate, highly specialized decoding logic.

2.  **Decoding Logic by Format:**

    * **PCM (`dispatchPCMDecode`)**:

        * This function further dispatches to optimized, "unrolled" decoding functions for the most common cases (1 and 2 channels). For example, `decodePCM16Stereo_unrolled` is a specialized function that processes 16-bit stereo data. These unrolled functions are much faster as they avoid loops and process data in larger chunks.
        * If the channel count is not 1 or 2, it falls back to the generic `decodeGenericPCM`, which loops through each sample and channel, reads the value using `readPcm`, and converts it to a float in the `[-1.0, 1.0]` range.
        * The conversion logic is standard:
            * 8-bit PCM is unsigned `[0, 255]`, so it's `(sample - 128) / 128`.
            * 16/24/32-bit PCM is signed, so it's `sample / 32768`, `sample / 8388608`, etc.

    * **IEEE Float (`dispatchFloatDecode`)**:

        * Similar to PCM, it uses optimized unrolled functions for 32-bit float mono/stereo data if the byte order (endianness) is little-endian, allowing it to just copy the data.
        * Otherwise, it falls back to `decodeFloat`, which uses a `DataView`'s `getFloat32` or `getFloat64` method to read each sample respecting the file's endianness. The values are clamped to `[-1.0, 1.0]`.

    * **A-law / µ-law (`decodeCompressed`)**:

        * These are 8-bit companding formats. The decoding is a simple and fast table lookup. Each 8-bit input value is used as an index into either `ALAW_TABLE` or `MULAW_TABLE` to get the corresponding 16-bit linear PCM value, which is then converted to a float.

    * **IMA ADPCM (`decodeImaAdpcm`)**:

        * This is the most complex algorithm. ADPCM is a lossy compression format that encodes the *difference* between samples in 4 bits (a nibble).
        * It processes the data one block at a time.
        * For each block, it first reads a header for each channel. This header contains an initial 16-bit sample value (**predictor**) and an initial **step index**.
        * It then iterates through the remaining data in the block, reading one 4-bit nibble at a time.
        * For each nibble, it performs the following steps:
            1.  Look up a **step value** in `IMA_STEP_TABLE` using the current `stepIndex`.
            2.  Calculate a **difference** from the nibble and the step value.
            3.  Add the difference to the previous sample's value (the `predictor`) to get the new sample.
            4.  Clamp the new sample to the 16-bit range `[-32768, 32767]`.
            5.  Update the `stepIndex` for the next nibble using the `IMA_INDEX_ADJUST_TABLE`.
            6.  The new sample becomes the `predictor` for the next iteration.
            7.  The final 16-bit sample is converted to a float and stored in the output `channelData`.

-----

### Summary

This `WavDecoder` is an excellent example of a modern, robust data processing pipeline. Its key strengths are:

* **Streaming:** The `RingBuffer` allows it to handle data of any size without high memory usage.
* **Performance:** It uses highly optimized, unrolled functions for common audio formats and a memory pool to reduce garbage collection, ensuring high throughput.
* **Robustness:** It gracefully handles common errors in WAV files (like incorrect block alignment), provides detailed error/warning messages, and maintains a stable state even when encountering problems.
* **Flexibility:** It supports all major WAV format variants, including PCM, floating-point, compressed A-law/µ-law, and the complex IMA ADPCM.
