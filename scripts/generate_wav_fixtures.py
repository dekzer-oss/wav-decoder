import math
import struct
from pathlib import Path

OUTPUT_DIR = Path("tests/fixtures")
DURATION_SECONDS = 1
RATE = 44100
AMPLITUDE = 0.8
FREQUENCY = 440.0

TEST_CONFIGS = [
    {'codec': 'pcm', 'bit_depth': 8, 'channels': 1, 'endian': 'little'},
    {'codec': 'pcm', 'bit_depth': 16, 'channels': 2, 'endian': 'little'},
    {'codec': 'pcm', 'bit_depth': 24, 'channels': 1, 'endian': 'little'},
    {'codec': 'pcm', 'bit_depth': 32, 'channels': 2, 'endian': 'little'},
    {'codec': 'pcm', 'bit_depth': 16, 'channels': 1, 'endian': 'big'},
    {'codec': 'pcm', 'bit_depth': 24, 'channels': 2, 'endian': 'big'},
    {'codec': 'float', 'bit_depth': 32, 'channels': 1, 'endian': 'little'},
    {'codec': 'float', 'bit_depth': 64, 'channels': 2, 'endian': 'little'},
    {'codec': 'float', 'bit_depth': 32, 'channels': 2, 'endian': 'big'},
    {'codec': 'alaw', 'bit_depth': 8, 'channels': 1, 'endian': 'little'},
    {'codec': 'ulaw', 'bit_depth': 8, 'channels': 2, 'endian': 'little'},
]


def linear_to_alaw(pcm_val):
    """
    Converts a 16-bit linear PCM value to 8-bit A-law using ITU-T G.711 standard segmentation.
    """
    # Clamp to 16-bit range and handle sign
    pcm_val = max(-32768, min(pcm_val, 32767))
    sign = 0x00 if pcm_val < 0 else 0x80
    pcm_val = abs(pcm_val)

    # Segment 0: values 0-31
    if pcm_val < 32:
        exponent = 0
        mantissa = pcm_val >> 1  # Shift 1 bit for 4-bit mantissa
    # Segments 1-7: values 32-4095
    else:
        # Define segment boundaries according to G.711 standard
        boundaries = [32, 64, 128, 256, 512, 1024, 2048, 4096]
        exponent = 7  # Default to highest segment
        # Find the matching segment
        for idx, boundary in enumerate(boundaries):
            if pcm_val < boundary:
                exponent = idx
                break

        # Calculate shift amount based on the segment
        shift = exponent + 3 if exponent > 1 else 4
        mantissa = (pcm_val >> shift) & 0x0F

    # Combine exponent and mantissa, apply A-law XOR mask and sign
    alaw_byte = (exponent << 4) | mantissa
    return (alaw_byte ^ 0x55) | sign


def linear_to_ulaw(pcm_val):
    """
    Converts a 16-bit linear PCM value to 8-bit μ-law using the ITU-T G.711 standard.
    """
    BIAS = 132  # Standard bias value
    MAX = 32635  # Effective maximum after bias adjustment

    # Clamp to symmetric 16-bit range and handle sign
    pcm_val = max(-32767, min(pcm_val, 32767))
    sign = 0xFF if pcm_val < 0 else 0x7F
    pcm_val = abs(pcm_val)

    # Apply compression limits and bias
    pcm_val = min(pcm_val, MAX)
    pcm_val += BIAS

    # Find the highest set bit (exponent)
    exponent = 7
    for exp in range(7, -1, -1):
        if pcm_val >= (1 << (exp + 5)):
            exponent = exp
            break

    # Extract mantissa (4 bits)
    mantissa = (pcm_val >> (exponent + 1)) & 0x0F

    # Combine exponent and mantissa, apply sign
    compressed = (exponent << 4) | mantissa
    return compressed ^ sign


# Converter references for clean code
ALAW_CONVERTER = linear_to_alaw
ULAW_CONVERTER = linear_to_ulaw


def generate_wav(config):
    """Generates a standards-compliant WAV file for decoder testing"""
    # Unpack configuration
    codec = config['codec']
    bit_depth = config['bit_depth']
    channels = config['channels']
    endian = config['endian']

    # Format tags from WAV specification
    format_tags = {'pcm': 1, 'float': 3, 'alaw': 6, 'ulaw': 7}
    format_tag = format_tags.get(codec)
    if format_tag is None:
        raise ValueError(f"Unsupported codec: {codec}")

    # Calculate audio parameters
    sample_width_bytes = bit_depth // 8
    num_frames = int(RATE * DURATION_SECONDS)
    block_align = channels * sample_width_bytes
    byte_rate = RATE * block_align
    data_size = num_frames * block_align

    # Endian handling
    endian_char = '<' if endian == 'little' else '>'
    riff_tag = b'RIFF' if endian == 'little' else b'RIFX'

    # Construct fmt chunk (extended for non-PCM)
    if format_tag in (6, 7):  # A-law/μ-law
        fmt_chunk_size = 18
        fmt_chunk_data = struct.pack(
            f'{endian_char}HHIIHHH',
            format_tag, channels, RATE, byte_rate, block_align, bit_depth, 0
        )
    else:  # PCM/Float
        fmt_chunk_size = 16
        fmt_chunk_data = struct.pack(
            f'{endian_char}HHIIHH',
            format_tag, channels, RATE, byte_rate, block_align, bit_depth
        )
    fmt_chunk = b'fmt ' + struct.pack(f'{endian_char}I', fmt_chunk_size) + fmt_chunk_data

    # Fact chunk required for non-PCM formats
    fact_chunk = b''
    if format_tag != 1:  # Non-PCM
        fact_chunk = struct.pack(f'{endian_char}4sII', b'fact', 4, num_frames)

    # Data chunk header
    data_chunk_header = struct.pack(f'{endian_char}4sI', b'data', data_size)

    # Calculate the complete file size (RIFF header size + chunks + data)
    chunks_size = len(fmt_chunk) + len(fact_chunk) + len(data_chunk_header) + data_size
    file_size = 4 + chunks_size  # 'WAVE' (4 bytes) + chunks

    # Create output filename
    ch_str = 'mono' if channels == 1 else 'stereo'
    endian_str = 'le' if endian == 'little' else 'be'
    filename = f"{codec}_d{bit_depth}_{endian_str}_{ch_str}.wav"
    filepath = OUTPUT_DIR / filename

    # Generate WAV file
    with open(filepath, 'wb') as f:
        # RIFF header
        f.write(riff_tag)
        f.write(struct.pack(f'{endian_char}I', file_size))
        f.write(b'WAVE')

        # Chunks
        f.write(fmt_chunk)
        if fact_chunk:
            f.write(fact_chunk)
        f.write(data_chunk_header)

        # Audio samplesDecoded
        for i in range(num_frames):
            # Generate sine wave sample
            angle = 2 * math.pi * i * FREQUENCY / RATE
            sample_float = math.sin(angle) * AMPLITUDE

            # Pre-calculate linear value for G.711 codecs
            if codec in ('alaw', 'ulaw'):
                linear_16bit = int(sample_float * 32767)

            # Write sample for each channel
            for _ in range(channels):
                if codec == 'pcm':
                    if bit_depth == 8:  # Unsigned 8-bit PCM
                        val = int((sample_float + 1.0) * 127.5)
                        f.write(struct.pack('B', val))
                    else:  # Signed PCM (16/24/32-bit)
                        max_val = 2 ** (bit_depth - 1) - 1
                        val = int(sample_float * max_val)
                        if bit_depth == 24:
                            f.write(val.to_bytes(3, byteorder=endian, signed=True))
                        else:
                            fmt_char = 'h' if bit_depth == 16 else 'i'
                            f.write(struct.pack(f'{endian_char}{fmt_char}', val))
                elif codec == 'float':  # 32/64-bit float
                    fmt_char = 'f' if bit_depth == 32 else 'd'
                    f.write(struct.pack(f'{endian_char}{fmt_char}', sample_float))
                elif codec == 'alaw':  # G.711 A-law
                    f.write(struct.pack('B', ALAW_CONVERTER(linear_16bit)))
                elif codec == 'ulaw':  # G.711 μ-law
                    f.write(struct.pack('B', ULAW_CONVERTER(linear_16bit)))

    print(f"Generated: {filepath}")


if __name__ == "__main__":
    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating WAV test files...")
    success_count = 0
    for config in TEST_CONFIGS:
        try:
            generate_wav(config)
            success_count += 1
        except Exception as e:
            print(f"Error generating {config['codec']} {config['bit_depth']}bit: {str(e)}")

    print(f"\nSuccessfully generated {success_count}/{len(TEST_CONFIGS)} test files in '{OUTPUT_DIR}'")
