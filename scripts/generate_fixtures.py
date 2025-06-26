import math
import os
import struct

OUTPUT_DIR = "../tests/fixtures"
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
    _SIGN_BIT = 0x80
    pcm_val = pcm_val >> 3
    mask = 0
    if pcm_val >= 0:
        mask = 0xD5
    else:
        mask = 0x55
        pcm_val = -pcm_val - 1

    if pcm_val < 32:
        val = pcm_val
    elif pcm_val < 64:
        val = ((pcm_val - 32) >> 1) + 32
    elif pcm_val < 128:
        val = ((pcm_val - 64) >> 2) + 48
    elif pcm_val < 256:
        val = ((pcm_val - 128) >> 3) + 64
    elif pcm_val < 512:
        val = ((pcm_val - 256) >> 4) + 80
    elif pcm_val < 1024:
        val = ((pcm_val - 512) >> 5) + 96
    elif pcm_val < 2048:
        val = ((pcm_val - 1024) >> 6) + 112
    else:
        val = 127

    return val ^ mask


def linear_to_ulaw(pcm_val):
    BIAS = 0x84
    MAX = 32635
    if pcm_val > MAX: pcm_val = MAX
    if pcm_val < -MAX: pcm_val = -MAX
    if pcm_val >= 0:
        val = BIAS + ((pcm_val * 32) // MAX)
    else:
        val = BIAS - ((abs(pcm_val) * 32) // MAX)

    return 255 - val


def generate_wav(config):
    codec = config['codec']
    bit_depth = config['bit_depth']
    channels = config['channels']
    endian = config['endian']

    ch_str = 'mono' if channels == 1 else 'stereo'
    file_prefix = f"{codec}_d{bit_depth}_{'le' if endian == 'little' else 'be'}_{ch_str}"
    filename = os.path.join(OUTPUT_DIR, f"{file_prefix}.wav")

    if codec == 'pcm':
        format_tag = 0x0001
    elif codec == 'float':
        format_tag = 0x0003
    elif codec == 'alaw':
        format_tag = 0x0006
    elif codec == 'ulaw':
        format_tag = 0x0007
    else:
        raise ValueError(f"Unknown codec: {codec}")

    sample_width_bytes = bit_depth // 8
    num_samples = int(RATE * DURATION_SECONDS)
    endian_char = '<' if endian == 'little' else '>'
    riff_tag = b'RIFF' if endian == 'little' else b'RIFX'

    block_align = channels * sample_width_bytes
    byte_rate = RATE * block_align
    fmt_chunk_id = b'fmt '
    fmt_chunk_size = 16
    fmt_chunk_data = struct.pack(
        f'{endian_char}HHIIHH',
        format_tag, channels, RATE, byte_rate, block_align, bit_depth
    )
    data_chunk_id = b'data'
    data_chunk_size = num_samples * block_align
    file_size = 4 + (8 + fmt_chunk_size) + (8 + data_chunk_size)

    with open(filename, 'wb') as f:
        f.write(riff_tag)
        f.write(struct.pack(f'{endian_char}I', file_size))
        f.write(b'WAVE')

        f.write(fmt_chunk_id)
        f.write(struct.pack(f'{endian_char}I', fmt_chunk_size))
        f.write(fmt_chunk_data)

        f.write(data_chunk_id)
        f.write(struct.pack(f'{endian_char}I', data_chunk_size))

        for i in range(num_samples):
            for ch in range(channels):
                angle = 2 * math.pi * i * FREQUENCY / RATE
                sample_float = math.sin(angle) * AMPLITUDE

                if codec == 'pcm':
                    max_amplitude = (2 ** (bit_depth - 1) - 1) if bit_depth > 8 else 255
                    if bit_depth == 8:
                        sample_val = int((sample_float + 1.0) / 2.0 * max_amplitude)
                        f.write(struct.pack('B', sample_val))
                    else:
                        sample_val = int(sample_float * max_amplitude)
                        if sample_width_bytes == 3:
                            f.write(sample_val.to_bytes(3, byteorder=endian, signed=True))
                        else:
                            type_char = {2: 'h', 4: 'i'}[sample_width_bytes]
                            f.write(struct.pack(f'{endian_char}{type_char}', sample_val))

                elif codec == 'float':
                    type_char = {4: 'f', 8: 'd'}[sample_width_bytes]
                    f.write(struct.pack(f'{endian_char}{type_char}', sample_float))

                elif codec in ['alaw', 'ulaw']:
                    sample_16bit = int(sample_float * (2 ** 15 - 1))
                    if codec == 'alaw':
                        f.write(struct.pack('B', linear_to_alaw(sample_16bit)))
                    else:
                        f.write(struct.pack('B', linear_to_ulaw(sample_16bit)))

    print(f"Generated: {filename}")


if __name__ == "__main__":
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    for config in TEST_CONFIGS:
        generate_wav(config)

    print(f"\nSuccessfully generated {len(TEST_CONFIGS)} WAV files in '{OUTPUT_DIR}' directory.")
