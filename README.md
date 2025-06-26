# WavStreamDecoder: Project Roadmap

This document outlines the development roadmap for the `wav-stream-decoder` library. Our goal is to create a robust, dependency-free, and highly compatible streaming WAV decoder for any JavaScript environment.

### ✅ **Version 1.0 (Completed)** - *Core Functionality & Robustness*

This version establishes a production-ready, thoroughly tested foundation for the decoder.

* **Core Feature:** High-performance streaming audio decoding.
* **Comprehensive Format Support:**
    * **PCM (Integer):** 8, 16, 24, and 32-bit.
    * **IEEE Float:** 32 and 64-bit.
    * **Companded:** A-Law and µ-Law.
* **Full Endianness Support:** Correctly handles both Little-Endian (`RIFF`) and Big-Endian (`RIFX`) files.
* **Isomorphic Design:** Runs seamlessly in both Node.js and modern browsers.
* **Rigorous Testing:**
    * Complete public API test coverage (`decode`, `decodeFrame`, `flush`, `free`).
    * "Golden File" testing against a comprehensive suite of generated WAV files to ensure correctness.

### ⏳ **Version 1.1 (Upcoming)** - *Hardening & Resilience*

This release will focus on making the decoder even more resilient to real-world, imperfect files.

* **Graceful Error Handling:** Implement robust checks for common file corruption issues.
    * Invalid or missing `fmt ` chunk.
    * Header values that are out of logical bounds (e.g., zero channels).
    * Chunk sizes that exceed the file size.
* **Mutation Testing:** Create a dedicated test suite that programmatically corrupts valid files to ensure the decoder fails predictably without crashing the host application.
* **Improved Error Messages:** Provide more specific and helpful error messages to aid developer debugging.

### 🚀 **Version 2.0 (Future)** - *Metadata Support*

This major version will introduce the ability to parse common metadata chunks, making the library more useful for professional audio applications.

* **Parse `LIST`/`INFO` Chunks:** Extract standard metadata such as `IART` (Artist), `INAM` (Title), `ICOP` (Copyright), etc.
* **Parse `bext` (Broadcast Wave Extension) Chunks:** Support for the BWF metadata format, which is standard in broadcasting and professional audio.
* **Extensible Metadata API:** Design a clean and accessible way for users to retrieve parsed metadata via the `info` getter.
* **(Potential) Parse `cue ` Chunks:** Add support for cue points, which are markers within the audio data.
