# WAV Decoder Behavioral Spec

## General
- Accept both RIFF (LE) and RIFX (BE) containers
- Require "WAVE" marker
- Parse and require "fmt " chunk, accept extra fields/extensions

## Audio Data
- PCM: Support 8/16/24/32 bit, all channel counts
- Float: Accept and preserve NaN/Infinity
- IMA ADPCM: Correct block/sample math
- Multi-data chunks: aggregate all, in order

## Errors/Warnings
- Throw errors for missing signatures, "fmt " chunk, or too-short header/chunk
- Non-fatal warnings for chunk size/file size mismatch, missing "data" chunk

## Streaming
- Allow decode calls with partial input; buffer until header is complete
- Only output audio when full frame(s) available

## Output
- Output per-channel Float32Arrays of correct length (matching channel/sample count)
- Output warnings and errors as array of objects with `message` string
