import math
import struct
import numpy as np
import os
from pathlib import Path

OUTPUT_DIR = Path("tests/fixtures/wav")
DURATION_SECONDS = 1
SAMPLE_RATE = 44100
AMPLITUDE = 0.8
SINE_FREQUENCY = 440.0
SWEEP_START_FREQ = 100.0
SWEEP_END_FREQ = 1000.0
# sine_pcm_24bit_be_stereo.wav
FIXTURE_CONFIGS = [
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
    {'codec': 'pcm', 'bit_depth': 24, 'channels': 8, 'endian': 'little'},
    {'codec': 'float', 'bit_depth': 32, 'channels': 8, 'endian': 'little'},
]

SWEEP_CONFIGS = [
    {'codec': 'pcm', 'bit_depth': 16, 'channels': 2, 'endian': 'little'},
    {'codec': 'pcm', 'bit_depth': 24, 'channels': 8, 'endian': 'little'},
    {'codec': 'float', 'bit_depth': 32, 'channels': 2, 'endian': 'little'},
    {'codec': 'float', 'bit_depth': 32, 'channels': 8, 'endian': 'little'},
]

def convert_linear_to_alaw(pcm_value):
    pcm_value = max(-32768, min(pcm_value, 32767))
    sign = 0x00 if pcm_value < 0 else 0x80
    pcm_value = abs(pcm_value)

    if pcm_value < 32:
        exponent = 0
        mantissa = pcm_value >> 1
    else:
        boundaries = [32, 64, 128, 256, 512, 1024, 2048, 4096]
        exponent = 7
        for idx, boundary in enumerate(boundaries):
            if pcm_value < boundary:
                exponent = idx
                break
        shift = exponent + 3 if exponent > 1 else 4
        mantissa = (pcm_value >> shift) & 0x0F

    alaw_byte = (exponent << 4) | mantissa
    return (alaw_byte ^ 0x55) | sign

def convert_linear_to_ulaw(pcm_value):
    BIAS = 132
    MAX_VALUE = 32635

    pcm_value = max(-32767, min(pcm_value, 32767))
    sign = 0xFF if pcm_value < 0 else 0x7F
    pcm_value = abs(pcm_value)
    pcm_value = min(pcm_value, MAX_VALUE)
    pcm_value += BIAS

    exponent = 7
    for exp in range(7, -1, -1):
        if pcm_value >= (1 << (exp + 5)):
            exponent = exp
            break

    mantissa = (pcm_value >> (exponent + 1)) & 0x0F
    compressed = (exponent << 4) | mantissa
    return compressed ^ sign

def get_channel_description(channels):
    if channels == 1:
        return 'mono'
    elif channels == 2:
        return 'stereo'
    else:
        return f'{channels}ch'

def get_endian_description(endian):
    return 'le' if endian == 'little' else 'be'

def generate_sine_wave_files():
    format_tags = {'pcm': 1, 'float': 3, 'alaw': 6, 'ulaw': 7}

    for config in FIXTURE_CONFIGS:
        codec = config['codec']
        bit_depth = config['bit_depth']
        channels = config['channels']
        endian = config['endian']

        format_tag = format_tags.get(codec)
        sample_width_bytes = bit_depth // 8
        total_frames = int(SAMPLE_RATE * DURATION_SECONDS)
        block_align = channels * sample_width_bytes
        byte_rate = SAMPLE_RATE * block_align
        data_size = total_frames * block_align
        endian_char = '<' if endian == 'little' else '>'
        riff_tag = b'RIFF' if endian == 'little' else b'RIFX'

        if format_tag in (6, 7):
            fmt_chunk_size = 18
            fmt_chunk_data = struct.pack(
                f'{endian_char}HHIIHHH',
                format_tag, channels, SAMPLE_RATE, byte_rate, block_align, bit_depth, 0
            )
        else:
            fmt_chunk_size = 16
            fmt_chunk_data = struct.pack(
                f'{endian_char}HHIIHH',
                format_tag, channels, SAMPLE_RATE, byte_rate, block_align, bit_depth
            )

        fmt_chunk = b'fmt ' + struct.pack(f'{endian_char}I', fmt_chunk_size) + fmt_chunk_data

        fact_chunk = b''
        if format_tag != 1:
            fact_chunk = struct.pack(f'{endian_char}4sII', b'fact', 4, total_frames)

        data_chunk_header = struct.pack(f'{endian_char}4sI', b'data', data_size)
        chunks_size = len(fmt_chunk) + len(fact_chunk) + len(data_chunk_header) + data_size
        file_size = 4 + chunks_size

        filename = f"sine_{codec}_{bit_depth}bit_{get_endian_description(endian)}_{get_channel_description(channels)}.wav"
        filepath = OUTPUT_DIR / filename

        with open(filepath, 'wb') as file:
            file.write(riff_tag)
            file.write(struct.pack(f'{endian_char}I', file_size))
            file.write(b'WAVE')
            file.write(fmt_chunk)
            if fact_chunk:
                file.write(fact_chunk)
            file.write(data_chunk_header)

            for frame_index in range(total_frames):
                angle = 2 * math.pi * frame_index * SINE_FREQUENCY / SAMPLE_RATE
                sample_float = math.sin(angle) * AMPLITUDE

                if codec in ('alaw', 'ulaw'):
                    linear_16bit = int(sample_float * 32767)

                for channel in range(channels):
                    if codec == 'pcm':
                        if bit_depth == 8:
                            value = int((sample_float + 1.0) * 127.5)
                            file.write(struct.pack('B', value))
                        else:
                            max_value = 2 ** (bit_depth - 1) - 1
                            value = int(sample_float * max_value)
                            if bit_depth == 24:
                                value = max(-8388608, min(8388607, value))
                                file.write(value.to_bytes(3, byteorder=endian, signed=True))
                            else:
                                format_char = 'h' if bit_depth == 16 else 'i'
                                file.write(struct.pack(f'{endian_char}{format_char}', value))
                    elif codec == 'float':
                        format_char = 'f' if bit_depth == 32 else 'd'
                        file.write(struct.pack(f'{endian_char}{format_char}', sample_float))
                    elif codec == 'alaw':
                        file.write(struct.pack('B', convert_linear_to_alaw(linear_16bit)))
                    elif codec == 'ulaw':
                        file.write(struct.pack('B', convert_linear_to_ulaw(linear_16bit)))

        print(f"Generated: {filepath}")

def generate_frequency_sweep_files():
    format_tags = {'pcm': 1, 'float': 3}

    for config in SWEEP_CONFIGS:
        codec = config['codec']
        bit_depth = config['bit_depth']
        channels = config['channels']
        endian = config['endian']

        format_tag = format_tags.get(codec)
        sample_width_bytes = bit_depth // 8
        total_frames = int(SAMPLE_RATE * DURATION_SECONDS)
        block_align = channels * sample_width_bytes
        byte_rate = SAMPLE_RATE * block_align
        data_size = total_frames * block_align
        endian_char = '<' if endian == 'little' else '>'
        riff_tag = b'RIFF' if endian == 'little' else b'RIFX'

        fmt_chunk = b'fmt ' + struct.pack(
            f'{endian_char}IHHIIHH',
            16, format_tag, channels, SAMPLE_RATE, byte_rate, block_align, bit_depth
        )

        data_chunk_header = struct.pack(f'{endian_char}4sI', b'data', data_size)
        # FIXED: Corrected RIFF chunk size calculation - removed the extra +4
        chunks_size = len(fmt_chunk) + len(data_chunk_header) + data_size
        file_size = 4 + chunks_size  # RIFF size is (total file size minus 8 bytes for RIFF header)

        filename = f"sweep_{codec}_{bit_depth}bit_{get_endian_description(endian)}_{get_channel_description(channels)}.wav"
        filepath = OUTPUT_DIR / filename

        with open(filepath, 'wb') as file:
            file.write(riff_tag)
            file.write(struct.pack(f'{endian_char}I', file_size))
            file.write(b'WAVE')
            file.write(fmt_chunk)
            file.write(data_chunk_header)

            for frame_index in range(total_frames):
                time = frame_index / SAMPLE_RATE

                for channel in range(channels):
                    frequency = SWEEP_START_FREQ * (SWEEP_END_FREQ / SWEEP_START_FREQ) ** (time / DURATION_SECONDS)
                    angle = 2 * math.pi * time * (frequency + channel * 50)
                    sample = math.sin(angle) * AMPLITUDE

                    if codec == 'pcm':
                        max_value = 2 ** (bit_depth - 1) - 1
                        value = int(sample * max_value)
                        if bit_depth == 24:
                            value = max(-8388608, min(8388607, value))
                            file.write(value.to_bytes(3, byteorder=endian, signed=True))
                        else:
                            format_char = 'h' if bit_depth == 16 else 'i'
                            file.write(struct.pack(f'{endian_char}{format_char}', value))
                    elif codec == 'float':
                        format_char = 'f' if bit_depth == 32 else 'd'
                        file.write(struct.pack(f'{endian_char}{format_char}', sample))

        print(f"Generated sweep file: {filepath}")

def generate_exotic_test_files():
    def create_wav_file(filename, data, sample_rate=44100, sample_width=2, num_channels=1):
        with open(OUTPUT_DIR / filename, "wb") as wav_file:
            if not isinstance(data, (bytes, bytearray)):
                data_bytes = data.tobytes()
            else:
                data_bytes = data

            total_frames = len(data_bytes) // (sample_width * num_channels)
            byte_rate = sample_rate * sample_width * num_channels
            block_align = sample_width * num_channels

            fmt_chunk = struct.pack('<4sIHHIIHH',
                                    b'fmt ', 16, 1, num_channels, sample_rate, byte_rate, block_align, sample_width * 8)
            data_chunk = struct.pack('<4sI', b'data', len(data_bytes)) + data_bytes
            riff_chunk = struct.pack('<4sI4s', b'RIFF', 36 + len(data_bytes), b'WAVE')

            wav_file.write(riff_chunk + fmt_chunk + data_chunk)

    def convert_to_pcm16(audio_array):
        audio_array = np.clip(audio_array, -1.0, 1.0)
        return (audio_array * 32767).astype(np.int16)

    def create_float32_with_nan_inf():
        samples = np.zeros(44100, dtype=np.float32)
        samples[100:110] = np.nan
        samples[200:210] = np.inf
        return samples.tobytes()

    silent_audio = convert_to_pcm16(np.zeros(44100))
    clipped_audio = convert_to_pcm16(np.ones(44100))

    alternating_pattern = np.zeros((44100, 2), dtype=np.int16)
    alternating_pattern[:, 0] = 32767
    alternating_pattern[:, 1] = 0

    short_audio = convert_to_pcm16(np.linspace(-1, 1, 80))

    create_wav_file("exotic_silent_pcm16_mono.wav", silent_audio)
    create_wav_file("exotic_clipped_pcm16_mono.wav", clipped_audio)
    create_wav_file("exotic_alt_clipped_silent_stereo.wav", alternating_pattern, num_channels=2)
    create_wav_file("exotic_short_pcm16_80samples.wav", short_audio)

    def create_float_wav_header(data_bytes, sample_rate=44100, num_channels=1):
        block_align = 4 * num_channels
        byte_rate = sample_rate * block_align
        fmt_chunk = struct.pack('<4sIHHIIHH',
                                b'fmt ', 16, 3, num_channels, sample_rate, byte_rate, block_align, 32)
        data_chunk = struct.pack('<4sI', b'data', len(data_bytes)) + data_bytes
        riff_chunk = struct.pack('<4sI4s', b'RIFF', 36 + len(data_bytes), b'WAVE')
        return riff_chunk + fmt_chunk + data_chunk

    float_audio = create_float32_with_nan_inf()
    with open(OUTPUT_DIR / "exotic_float32_nan_inf.wav", "wb") as file:
        file.write(create_float_wav_header(float_audio))

    print(f"Exotic WAV test files written to: {OUTPUT_DIR.resolve()}")

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating sine wave WAV files...")
    generate_sine_wave_files()

    print("Generating frequency sweep WAV files...")
    generate_frequency_sweep_files()

    print("Generating exotic test WAV files...")
    generate_exotic_test_files()

    print("All WAV test files generated in:", OUTPUT_DIR.resolve())

if __name__ == "__main__":
    main()
