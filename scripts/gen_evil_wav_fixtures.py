import struct
from pathlib import Path

EVIL_DIR = Path("tests/fixtures/evil_wav")
EVIL_DIR.mkdir(parents=True, exist_ok=True)

def write_wav(header: bytes, data: bytes, filename: str):
    with open(EVIL_DIR / filename, "wb") as f:
        f.write(header)
        f.write(data)
    print("Evil WAV written:", filename)

def generate_evil_wavs():
    # Standard fmt chunk for reference
    std_fmt = b'\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00'
    std_data_chunk = struct.pack('<4sI', b'data', 32) + b'\x00' * 32

    # 1. RIFF size less than actual file
    header = struct.pack('<4sI4s', b'RIFF', 20, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    write_wav(header, std_data_chunk, "evil_small_riff.wav")

    # 2. RIFF size greater than file (overclaimed)
    header = struct.pack('<4sI4s', b'RIFF', 99999, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    write_wav(header, std_data_chunk, "evil_big_riff.wav")

    # 3. Multiple data chunks, one empty, one normal
    header = struct.pack('<4sI4s', b'RIFF', 100, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    multi_data = struct.pack('<4sI', b'data', 0) + struct.pack('<4sI', b'data', 32) + b'\x01' * 32
    write_wav(header, multi_data, "evil_multi_data_chunks.wav")

    # 4. Data chunk before fmt chunk (non-canonical order)
    header2 = struct.pack('<4sI4s', b'RIFF', 20 + 8 + 32, b'WAVE') + struct.pack('<4sI', b'data', 32) + b'\x00' * 32 + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    write_wav(header2, b'', "evil_data_before_fmt.wav")

    # 5. Odd chunk sizes with padding
    header3 = struct.pack('<4sI4s', b'RIFF', 60, b'WAVE') + struct.pack('<4sI', b'fmt ', 17) + std_fmt + b'\x00'
    data_padded = struct.pack('<4sI', b'data', 33) + b'\x00' * 33 + b'\x00'
    write_wav(header3, data_padded, "evil_odd_chunk_size.wav")

    # 6. Truncated file (missing data)
    header4 = struct.pack('<4sI4s', b'RIFF', 40, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    truncated_data = struct.pack('<4sI', b'data', 32) + b'\x00' * 10  # Claims 32 bytes but only has 10
    write_wav(header4, truncated_data, "evil_truncated.wav")

    # 7. No fmt chunk at all
    header5 = struct.pack('<4sI4s', b'RIFF', 36, b'WAVE')
    write_wav(header5, std_data_chunk, "evil_no_fmt_chunk.wav")

    # 8. Missing data chunk entirely
    header6 = struct.pack('<4sI4s', b'RIFF', 28, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    write_wav(header6, b'', "evil_no_data_chunk.wav")

    # 9. fmt chunk with zero size
    header7 = struct.pack('<4sI4s', b'RIFF', 40, b'WAVE') + struct.pack('<4sI', b'fmt ', 0)
    write_wav(header7, std_data_chunk, "evil_zero_fmt_size.wav")

    # 10. fmt chunk too small (less than 16 bytes)
    header8 = struct.pack('<4sI4s', b'RIFF', 30, b'WAVE') + struct.pack('<4sI', b'fmt ', 8) + b'\x01\x00\x01\x00\x44\xac\x00\x00'
    write_wav(header8, std_data_chunk, "evil_tiny_fmt.wav")

    # 11. Invalid format tag (not 1, 3, 6, or 7)
    bad_fmt = b'\x99\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00'
    header9 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + bad_fmt
    write_wav(header9, std_data_chunk, "evil_bad_format_tag.wav")

    # 12. Zero channels
    zero_ch_fmt = b'\x01\x00\x00\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00'
    header10 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + zero_ch_fmt
    write_wav(header10, std_data_chunk, "evil_zero_channels.wav")

    # 13. Extreme channel count (65535)
    extreme_ch_fmt = b'\x01\x00\xff\xff\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00'
    header11 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + extreme_ch_fmt
    write_wav(header11, std_data_chunk, "evil_extreme_channels.wav")

    # 14. Zero sample rate
    zero_sr_fmt = b'\x01\x00\x01\x00\x00\x00\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00'
    header12 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + zero_sr_fmt
    write_wav(header12, std_data_chunk, "evil_zero_sample_rate.wav")

    # 15. Invalid bit depth (not 8, 16, 24, 32)
    bad_bits_fmt = b'\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x0d\x00'  # 13 bits
    header13 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + bad_bits_fmt
    write_wav(header13, std_data_chunk, "evil_bad_bit_depth.wav")

    # 16. Inconsistent block align vs channels/bits
    bad_align_fmt = b'\x01\x00\x02\x00\x44\xac\x00\x00\x88\x58\x01\x00\x01\x00\x10\x00'  # 2 channels but block align = 1
    header14 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + bad_align_fmt
    write_wav(header14, std_data_chunk, "evil_bad_block_align.wav")

    # 17. Big endian RIFX with little endian chunks (mixed endianness)
    header15 = struct.pack('>4sI4s', b'RIFX', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt  # RIFX but LE chunks
    write_wav(header15, std_data_chunk, "evil_mixed_endian.wav")

    # 18. Corrupted chunk IDs
    header16 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmx ', 16) + std_fmt  # "fmx" instead of "fmt"
    write_wav(header16, std_data_chunk, "evil_bad_chunk_id.wav")

    # 19. Chunk size claims to extend beyond file end
    header17 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    oversized_data = struct.pack('<4sI', b'data', 99999) + b'\x00' * 32  # Claims 99999 bytes but only has 32
    write_wav(header17, oversized_data, "evil_oversized_chunk.wav")

    # 20. Empty file
    write_wav(b'', b'', "evil_empty_file.wav")

    # 21. Just "RIFF" (4 bytes)
    write_wav(b'RIFF', b'', "evil_just_riff.wav")

    # 22. Invalid RIFF signature
    header18 = struct.pack('<4sI4s', b'RIFF', 44, b'WXYZ') + struct.pack('<4sI', b'fmt ', 16) + std_fmt  # "WXYZ" instead of "WAVE"
    write_wav(header18, std_data_chunk, "evil_bad_wave_signature.wav")

    # 23. Nested/recursive chunks (LIST chunk containing another RIFF)
    list_chunk = struct.pack('<4sI4s', b'LIST', 20, b'INFO') + struct.pack('<4sI4s', b'RIFF', 8, b'WAVE')
    header19 = struct.pack('<4sI4s', b'RIFF', 60, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + std_fmt
    write_wav(header19, list_chunk + std_data_chunk, "evil_nested_chunks.wav")

    # 24. Float format but integer data
    float_fmt = b'\x03\x00\x01\x00\x44\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x20\x00'  # IEEE float format
    header20 = struct.pack('<4sI4s', b'RIFF', 44, b'WAVE') + struct.pack('<4sI', b'fmt ', 16) + float_fmt
    int_data = struct.pack('<4sI', b'data', 32) + struct.pack('<8h', *[1000, -1000, 2000, -2000, 0, 32767, -32768, 100])
    write_wav(header20, int_data, "evil_float_fmt_int_data.wav")

    print("Enhanced evil/fuzz WAVs generated in:", EVIL_DIR.resolve())

if __name__ == "__main__":
    generate_evil_wavs()
