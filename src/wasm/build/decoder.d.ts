/**
 * @module '@/wasm/build/decoder'
 * @description This module provides TypeScript declarations for the WebAssembly audio decoder.
 * It defines the interface for interacting with the compiled Wasm module, including functions
 * for parsing WAV headers and decoding various audio formats.
 */
declare module '@/wasm/build/decoder' {
  /**
   * @interface WavHeader
   * @description Represents the metadata parsed from a WAV file's header.
   * All fields correspond to the standard WAV format structure.
   */
  export interface WavHeader {
    /**
     * The audio format code. For example, 1 for PCM.
     * @type {number} uint16
     */
    audio_format: number;

    /**
     * The number of audio channels. 1 for mono, 2 for stereo.
     * @type {number} uint16
     */
    num_channels: number;

    /**
     * The sample rate (e.g., 44100, 48000).
     * @type {number} uint32
     */
    sample_rate: number;

    /**
     * The byte rate of the audio data (sample_rate * num_channels * bits_per_sample / 8).
     * @type {number} uint32
     */
    byte_rate: number;

    /**
     * The block alignment in bytes. Specifies the byte size of a single sample frame.
     * @type {number} uint16
     */
    block_align: number;

    /**
     * The number of bits per sample (e.g., 8, 16, 24, 32).
     * @type {number} uint16
     */
    bits_per_sample: number;

    /**
     * The starting position (in bytes) of the data chunk within the file.
     * @type {number} uint32
     */
    data_chunk_pos: number;

    /**
     * The size (in bytes) of the audio data chunk.
     * @type {number} uint32
     */
    data_chunk_size: number;
  }

  /**
   * @interface WasmDecoderModule
   * @description Defines the exported functions and memory views of the compiled WebAssembly decoder module.
   * Functions prefixed with an underscore are typically C functions exposed by Emscripten.
   */
  export interface WasmDecoderModule {
    /**
     * Allocates a block of memory of the specified size on the WebAssembly heap.
     * @param {number} size - The number of bytes to allocate.
     * @returns {number} A pointer to the beginning of the allocated memory block. Returns 0 if allocation fails.
     */
    _malloc(size: number): number;

    /**
     * Frees a previously allocated block of memory on the WebAssembly heap.
     * @param {number} ptr - A pointer to the memory block to be freed.
     */
    _free(ptr: number): void;

    /**
     * Parses the header of a WAV file from a byte array.
     * @param {number} dataPtr - A pointer to the input data buffer (uint8_t*) in the Wasm heap.
     * @param {number} dataSize - The size of the input data buffer (uint32_t).
     * @param {number} headerPtr - A pointer to a `WavHeader` struct in the Wasm heap where the parsed data will be written.
     * @returns {number} Returns 1 on successful parsing, 0 on failure.
     */
    _parse_header(dataPtr: number, dataSize: number, headerPtr: number): number;

    /**
     * Decodes 8-bit PCM mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (int8_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_pcm8_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 8-bit PCM stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (int8_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_pcm8_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes 16-bit PCM mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (int16_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_pcm16_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 16-bit PCM stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (int16_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_pcm16_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes 24-bit PCM mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (uint8_t* representing 24-bit samples).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_pcm24_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 24-bit PCM stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (uint8_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_pcm24_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes 32-bit PCM mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (int32_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_pcm32_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 32-bit PCM stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (int32_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_pcm32_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes 32-bit float mono audio data.
     * @param {number} inPtr - Pointer to the input buffer (float*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_float32_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 32-bit float stereo audio data.
     * @param {number} inPtr - Pointer to the interleaved input buffer (float*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_float32_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes 64-bit float (double) mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (double*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_float64_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes 64-bit float (double) stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (double*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_float64_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes A-law compressed mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (uint8_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_alaw_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes A-law compressed stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (uint8_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_alaw_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes μ-law compressed mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (uint8_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n - The number of samples to decode.
     */
    _decode_ulaw_mono(inPtr: number, outPtr: number, n: number): void;

    /**
     * Decodes μ-law compressed stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (uint8_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n - The number of sample frames to decode.
     */
    _decode_ulaw_stereo(inPtr: number, leftPtr: number, rightPtr: number, n: number): void;

    /**
     * Decodes IMA ADPCM compressed mono audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the input buffer (uint8_t*).
     * @param {number} outPtr - Pointer to the output buffer (float*).
     * @param {number} n_blocks - The number of ADPCM blocks to process.
     * @param {number} samples_per_block - The number of samples contained within each block.
     */
    _decode_ima_adpcm_mono(
      inPtr: number,
      outPtr: number,
      n_blocks: number,
      samples_per_block: number,
    ): void;

    /**
     * Decodes IMA ADPCM compressed stereo audio data. Output is 32-bit float.
     * @param {number} inPtr - Pointer to the interleaved input buffer (uint8_t*).
     * @param {number} leftPtr - Pointer to the output buffer for the left channel (float*).
     * @param {number} rightPtr - Pointer to the output buffer for the right channel (float*).
     * @param {number} n_blocks - The number of ADPCM blocks to process.
     * @param {number} samples_per_block - The number of samples contained within each block.
     */
    _decode_ima_adpcm_stereo(
      inPtr: number,
      leftPtr: number,
      rightPtr: number,
      n_blocks: number,
      samples_per_block: number,
    ): void;

    /**
     * A view into the WebAssembly linear memory as an 8-bit unsigned integer array.
     * Used for writing input data to and reading byte-level data from the Wasm module.
     * @type {Uint8Array}
     */
    HEAPU8: Uint8Array;

    /**
     * A view into the WebAssembly linear memory as a 32-bit float array.
     * Used for reading decoded floating-point audio data from the Wasm module.
     * @type {Float32Array}
     */
    HEAPF32: Float32Array;

    /**
     * Reads a value of a specific type from a memory address on the Wasm heap.
     * @param {number} ptr - The memory address to read from.
     * @param {string} type - The data type to read (e.g., 'i8', 'i16', 'i32', 'float', 'double').
     * @returns {number} The value read from memory.
     */
    getValue(ptr: number, type: string): number;

    /**
     * Writes a value of a specific type to a memory address on the Wasm heap.
     * @param {number} ptr - The memory address to write to.
     * @param {number} value - The value to write.
     * @param {string} type - The data type to write (e.g., 'i8', 'i16', 'i32', 'float', 'double').
     */
    setValue(ptr: number, value: number, type: string): void;
  }

  /**
   * The default export of the Emscripten-generated 'decoder.js' glue file.
   * This is a factory function that initializes and returns a Promise, which
   * resolves to the fully loaded and ready-to-use `WasmDecoderModule` instance.
   *
   * @param {any} [options] - Optional Emscripten module configuration options.
   * @returns {Promise<WasmDecoderModule>} A promise that resolves with the decoder module instance.
   */
  const createWavDecoderModule: (options?: any) => Promise<WasmDecoderModule>;
  export default createWavDecoderModule;
}
