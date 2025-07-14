import math
import struct
import numpy as np
import os
from pathlib import Path

OUTPUT_DIR = Path("tests/fixtures/wav")
DURATION_SECONDS = 1
RATE = 44100
AMPLITUDE = 0.8
FREQUENCY = 440.0

# --- Test Configs ---
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

START_FREQ = 100.0
END_FREQ = 1000.0

# --- G.711 Converters ---
def linear_to_alaw(pcm_val):
    pcm_val = max(-32768, min(pcm_val, 32767))
    sign = 0x00 if pcm_val < 0 else 0x80
    pcm_val = abs(pcm_val)
    if pcm_val < 32:
        exponent = 0
        mantissa = pcm_val >> 1
    else:
        boundaries = [32, 64, 128, 256, 512, 1024, 2048, 4096]
        exponent = 7
        for idx, boundary in enumerate(boundaries):
            if pcm_val < boundary:
                exponent = idx
                break
        shift = exponent + 3 if exponent > 1 else 4
        mantissa = (pcm_val >> shift) & 0x0F
    alaw_byte = (exponent << 4) | mantissa
    return (alaw_byte ^ 0x55) | sign

def linear_to_ulaw(pcm_val):
    BIAS = 132
    MAX = 32635
    pcm_val = max(-32767, min(pcm_val, 32767))
    sign = 0xFF if pcm_val < 0 else 0x7F
    pcm_val = abs(pcm_val)
    pcm_val = min(pcm_val, MAX)
    pcm_val += BIAS
    exponent = 7
    for exp in range(7, -1, -1):
        if pcm_val >= (1 << (exp + 5)):
            exponent = exp
            break
    mantissa = (pcm_val >> (exponent + 1)) & 0x0F
    compressed = (exponent << 4) | mantissa
    return compressed ^ sign

# --- Utility for channel string ---
def channel_str(channels):
    if channels == 1:
        return 'mono'
    elif channels == 2:
        return 'stereo'
    else:
        return f'{channels}ch'

def endian_str(endian):
    return 'le' if endian == 'little' else 'be'

# --- Fixtures: Sine Wave ---
def generate_fixture_wavs():
    format_tags = {'pcm': 1, 'float': 3, 'alaw': 6, 'ulaw': 7}
    for config in FIXTURE_CONFIGS:
        codec = config['codec']
        bit_depth = config['bit_depth']
        channels = config['channels']
        endian = config['endian']
        format_tag = format_tags.get(codec)
        sample_width_bytes = bit_depth // 8
        num_frames = int(RATE * DURATION_SECONDS)
        block_align = channels * sample_width_bytes
        byte_rate = RATE * block_align
        data_size = num_frames * block_align
        endian_char = '<' if endian == 'little' else '>'
        riff_tag = b'RIFF' if endian == 'little' else b'RIFX'
        if format_tag in (6, 7):
            fmt_chunk_size = 18
            fmt_chunk_data = struct.pack(
                f'{endian_char}HHIIHHH',
                format_tag, channels, RATE, byte_rate, block_align, bit_depth, 0
            )
        else:
            fmt_chunk_size = 16
            fmt_chunk_data = struct.pack(
                f'{endian_char}HHIIHH',
                format_tag, channels, RATE, byte_rate, block_align, bit_depth
            )
        fmt_chunk = b'fmt ' + struct.pack(f'{endian_char}I', fmt_chunk_size) + fmt_chunk_data
        fact_chunk = b''
        if format_tag != 1:
            fact_chunk = struct.pack(f'{endian_char}4sII', b'fact', 4, num_frames)
        data_chunk_header = struct.pack(f'{endian_char}4sI', b'data', data_size)
        chunks_size = len(fmt_chunk) + len(fact_chunk) + len(data_chunk_header) + data_size
        file_size = 4 + chunks_size
        fname = f"sine_{codec}_{bit_depth}bit_{endian_str(endian)}_{channel_str(channels)}.wav"
        filepath = OUTPUT_DIR / fname
        with open(filepath, 'wb') as f:
            f.write(riff_tag)
            f.write(struct.pack(f'{endian_char}I', file_size))
            f.write(b'WAVE')
            f.write(fmt_chunk)
            if fact_chunk:
                f.write(fact_chunk)
            f.write(data_chunk_header)
            for i in range(num_frames):
                angle = 2 * math.pi * i * FREQUENCY / RATE
                sample_float = math.sin(angle) * AMPLITUDE
                if codec in ('alaw', 'ulaw'):
                    linear_16bit = int(sample_float * 32767)
                for _ in range(channels):
                    if codec == 'pcm':
                        if bit_depth == 8:
                            # 8-bit PCM is unsigned: offset by +128
                            val = int((sample_float + 1.0) * 127.5)
                            f.write(struct.pack('B', val))
                        else:
                            max_val = 2 ** (bit_depth - 1) - 1
                            val = int(sample_float * max_val)
                            if bit_depth == 24:
                                # Clamp 24-bit PCM values to [-8388608, 8388607]
                                val = max(-8388608, min(8388607, val))
                                f.write(val.to_bytes(3, byteorder=endian, signed=True))
                            else:
                                fmt_char = 'h' if bit_depth == 16 else 'i'
                                f.write(struct.pack(f'{endian_char}{fmt_char}', val))
                    elif codec == 'float':
                        fmt_char = 'f' if bit_depth == 32 else 'd'
                        f.write(struct.pack(f'{endian_char}{fmt_char}', sample_float))
                    elif codec == 'alaw':
                        f.write(struct.pack('B', linear_to_alaw(linear_16bit)))
                    elif codec == 'ulaw':
                        f.write(struct.pack('B', linear_to_ulaw(linear_16bit)))
        print(f"Generated: {filepath}")

# --- Sweeps ---
def generate_sweep_wavs():
    format_tags = {'pcm': 1, 'float': 3}
    for config in SWEEP_CONFIGS:
        codec = config['codec']
        bit_depth = config['bit_depth']
        channels = config['channels']
        endian = config['endian']
        format_tag = format_tags.get(codec)
        sample_width_bytes = bit_depth // 8
        num_frames = int(RATE * DURATION_SECONDS)
        block_align = channels * sample_width_bytes
        byte_rate = RATE * block_align
        data_size = num_frames * block_align
        endian_char = '<' if endian == 'little' else '>'
        riff_tag = b'RIFF' if endian == 'little' else b'RIFX'
        fmt_chunk = b'fmt ' + struct.pack(
            f'{endian_char}IHHIIHH',
            16, format_tag, channels, RATE, byte_rate, block_align, bit_depth
        )
        data_chunk_header = struct.pack(f'{endian_char}4sI', b'data', data_size)
        chunks_size = len(fmt_chunk) + len(data_chunk_header) + data_size + 4
        file_size = 4 + chunks_size
        fname = f"sweep_{codec}_{bit_depth}bit_{endian_str(endian)}_{channel_str(channels)}.wav"
        filepath = OUTPUT_DIR / fname
        with open(filepath, 'wb') as f:
            f.write(riff_tag)
            f.write(struct.pack(f'{endian_char}I', file_size))
            f.write(b'WAVE')
            f.write(fmt_chunk)
            f.write(data_chunk_header)
            for i in range(num_frames):
                t = i / RATE
                for ch in range(channels):
                    # Log-sweep for more realistic frequency range testing
                    freq = START_FREQ * (END_FREQ / START_FREQ) ** (t / DURATION_SECONDS)
                    angle = 2 * math.pi * t * (freq + ch * 50)
                    sample = math.sin(angle) * AMPLITUDE
                    if codec == 'pcm':
                        max_val = 2 ** (bit_depth - 1) - 1
                        val = int(sample * max_val)
                        if bit_depth == 24:
                            # Clamp 24-bit PCM values to [-8388608, 8388607]
                            val = max(-8388608, min(8388607, val))
                            f.write(val.to_bytes(3, byteorder=endian, signed=True))
                        else:
                            fmt_char = 'h' if bit_depth == 16 else 'i'
                            f.write(struct.pack(f'{endian_char}{fmt_char}', val))
                    elif codec == 'float':
                        fmt_char = 'f' if bit_depth == 32 else 'd'
                        f.write(struct.pack(f'{endian_char}{fmt_char}', sample))
        print(f"Generated sweep file: {filepath}")

# --- Exotic WAVs ---
def generate_exotic_wavs():
    def save_wave(filename, data, sample_rate=44100, sampwidth=2, nchannels=1):
        with open(OUTPUT_DIR / filename, "wb") as wf:
            # Write a minimal PCM header
            # Ensure data is bytes
            if not isinstance(data, (bytes, bytearray)):
                data_bytes = data.tobytes()
            else:
                data_bytes = data
            nframes = len(data_bytes) // (sampwidth * nchannels)
            byte_rate = sample_rate * sampwidth * nchannels
            block_align = sampwidth * nchannels
            fmt_chunk = struct.pack('<4sIHHIIHH',
                b'fmt ', 16, 1, nchannels, sample_rate, byte_rate, block_align, sampwidth * 8)
            data_chunk = struct.pack('<4sI', b'data', len(data_bytes)) + data_bytes
            riff_chunk = struct.pack('<4sI4s', b'RIFF', 36 + len(data_bytes), b'WAVE')
            wf.write(riff_chunk + fmt_chunk + data_chunk)
    def to_pcm16(x):
        x = np.clip(x, -1.0, 1.0)
        return (x * 32767).astype(np.int16)
    # 1. NaN / Inf values (for float32 WAV)
    def float32_nan_inf_wave():
        samples = np.zeros(44100, dtype=np.float32)
        samples[100:110] = np.nan
        samples[200:210] = np.inf
        return samples.tobytes()
    # 2. Silent 16-bit PCM mono
    silent_pcm = to_pcm16(np.zeros(44100))
    # 3. Max clipped signal
    clipped_pcm = to_pcm16(np.ones(44100))
    # 4. Alternating clipped/silent stereo pattern
    alt_pattern = np.zeros((44100, 2), dtype=np.int16)
    alt_pattern[:, 0] = 32767
    alt_pattern[:, 1] = 0
    # 5. Very short file (<100 samples)
    short_pcm = to_pcm16(np.linspace(-1, 1, 80))
    # Save standard test WAVs
    save_wave("exotic_silent_pcm16_mono.wav", silent_pcm)
    save_wave("exotic_clipped_pcm16_mono.wav", clipped_pcm)
    save_wave("exotic_alt_clipped_silent_stereo.wav", alt_pattern, nchannels=2)
    save_wave("exotic_short_pcm16_80samples.wav", short_pcm)
    # Save float32 with NaN/Inf manually (PCM float32 = formatTag code 3)
    def write_float_wav_header(data_bytes, sample_rate=44100, nchannels=1):
        block_align = 4 * nchannels
        byte_rate = sample_rate * block_align
        fmt_chunk = struct.pack('<4sIHHIIHH',
            b'fmt ', 16, 3, nchannels, sample_rate, byte_rate, block_align, 32)
        data_chunk = struct.pack('<4sI', b'data', len(data_bytes)) + data_bytes
        riff_chunk = struct.pack('<4sI4s', b'RIFF', 36 + len(data_bytes), b'WAVE')
        return riff_chunk + fmt_chunk + data_chunk
    float_pcm = float32_nan_inf_wave()
    with open(OUTPUT_DIR / "exotic_float32_nan_inf.wav", "wb") as f:
        f.write(write_float_wav_header(float_pcm))
    print(f"Exotic WAV test files written to: {OUTPUT_DIR.resolve()}")

# --- Main ---
def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Generating fixture (sine) WAV files...")
    generate_fixture_wavs()
    print("Generating sweep WAV files...")
    generate_sweep_wavs()
    print("Generating exotic WAV files...")
    generate_exotic_wavs()
    print("All WAV test files generated in:", OUTPUT_DIR.resolve())

if __name__ == "__main__":
    main()
