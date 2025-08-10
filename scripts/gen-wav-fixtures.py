#!/usr/bin/env python3
"""
WAV fixture generator for tests/benchmarks.

Features
- Sine and sweep fixtures across PCM/float/A‑law/µ‑law.
- Endianness coverage (RIFF little‑endian, RIFX big‑endian) where valid.
- Multi‑channel variants (1, 2, 8ch) for buffer/de‑interleave tests.
- "Exotic" edge cases (NaN/Inf, short files, clipped, alternating silence).
- Worst‑case formats to stress non‑SIMD paths: PCM 32‑bit stereo, Float64 stereo.
- Simple CLI to filter what is generated.

Note: IMA ADPCM encode is not provided (toggle left in place for future use).
"""
from __future__ import annotations

import argparse
import math
import struct
from pathlib import Path
from typing import Iterable, Dict, Any

import numpy as np
import json

# --------------------------------------------------------------------------------------
# Defaults (overridable by CLI).
# --------------------------------------------------------------------------------------
OUTPUT_DIR: Path = Path("tests/fixtures/wav")
DURATION_SECONDS: float = 1.0
RATE: int = 44_100
AMPLITUDE: float = 0.8
FREQUENCY: float = 440.0

# Collected metadata for manifest.json
MANIFEST: Dict[str, Dict[str, Any]] = {}

START_FREQ = 100.0
END_FREQ = 1000.0

# Toggle when an encoder is available.
GENERATE_IMA_ADPCM = True

# --------------------------------------------------------------------------------------
# Config matrices
# --------------------------------------------------------------------------------------
FIXTURE_CONFIGS = [
    {"codec": "pcm",   "bit_depth": 8,  "channels": 1, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 16, "channels": 2, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 24, "channels": 1, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 32, "channels": 2, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 16, "channels": 1, "endian": "big"},
    {"codec": "pcm",   "bit_depth": 24, "channels": 2, "endian": "big"},
    {"codec": "float", "bit_depth": 32, "channels": 1, "endian": "little"},
    {"codec": "float", "bit_depth": 64, "channels": 2, "endian": "little"},
    {"codec": "float", "bit_depth": 32, "channels": 2, "endian": "big"},
    {"codec": "alaw",  "bit_depth": 8,  "channels": 1, "endian": "little"},
    {"codec": "ulaw",  "bit_depth": 8,  "channels": 2, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 24, "channels": 8, "endian": "little"},
    {"codec": "float", "bit_depth": 32, "channels": 8, "endian": "little"},
]

SWEEP_CONFIGS = [
    {"codec": "pcm",   "bit_depth": 16, "channels": 2, "endian": "little"},
    {"codec": "pcm",   "bit_depth": 24, "channels": 8, "endian": "little"},
    {"codec": "float", "bit_depth": 32, "channels": 2, "endian": "little"},
    {"codec": "float", "bit_depth": 32, "channels": 8, "endian": "little"},
]

# --------------------------------------------------------------------------------------
# G.711 helpers
# --------------------------------------------------------------------------------------
def linear_to_alaw(pcm_val: int) -> int:
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
        shift = (exponent + 3) if exponent > 1 else 4
        mantissa = (pcm_val >> shift) & 0x0F
    alaw_byte = (exponent << 4) | mantissa
    return (alaw_byte ^ 0x55) | sign

def linear_to_ulaw(pcm_val: int) -> int:
    BIAS = 132; MAXV = 32635
    pcm_val = max(-32767, min(pcm_val, 32767))
    sign = 0xFF if pcm_val < 0 else 0x7F
    pcm_val = min(abs(pcm_val), MAXV) + BIAS
    exponent = next(exp for exp in range(7, -1, -1) if pcm_val >= (1 << (exp+5)))
    mantissa = (pcm_val >> (exponent+1)) & 0x0F
    return ((exponent<<4) | mantissa) ^ sign

# --------------------------------------------------------------------------------------
# Naming helpers
# --------------------------------------------------------------------------------------
def channel_str(ch: int) -> str:
    return "mono" if ch==1 else "stereo" if ch==2 else f"{ch}ch"
def endian_str(e: str) -> str:
    return "le" if e=="little" else "be"
FORMAT_TAGS = {"pcm":1, "float":3, "alaw":6, "ulaw":7}

def record_manifest(
        fname: str, *, channels:int, sample_rate:int, bit_depth:int,
        format_tag:int, samples_per_channel:int
) -> None:
    MANIFEST[fname] = {
        "channels": channels,
        "sampleRate": sample_rate,
        "bitsPerSample": bit_depth,
        "formatTag": format_tag,
        "samplesPerChannel": samples_per_channel,
    }

# --------------------------------------------------------------------------------------
# Header writer
# --------------------------------------------------------------------------------------
def write_wav_header(f, *, endian:str, format_tag:int, channels:int,
                     sample_rate:int, bit_depth:int, data_size:int,
                     fact_num_samples:int|None=None) -> None:
    ec = "<" if endian=="little" else ">"
    riff = b"RIFF" if endian=="little" else b"RIFX"
    ba = channels*(bit_depth//8); br = sample_rate*ba
    if format_tag in (6,7): chunk_size=18; extra=0
    else: chunk_size=16; extra=None
    fmt_hdr = struct.pack(
        f"{ec}4sIHHIIHH{'H' if extra is not None else ''}",
        b"fmt ", chunk_size, format_tag, channels, sample_rate,
        br, ba, bit_depth, *( [extra] if extra is not None else [] )
    )
    fact = b'' if format_tag==1 or fact_num_samples is None else struct.pack(f"{ec}4sII", b"fact",4,fact_num_samples)
    data_hdr = struct.pack(f"{ec}4sI", b"data", data_size)
    f.write(riff)
    f.write(struct.pack(f"{ec}I", 4 + len(fmt_hdr) + len(fact) + len(data_hdr) + data_size))
    f.write(b"WAVE"); f.write(fmt_hdr)
    if fact: f.write(fact)
    f.write(data_hdr)

# --------------------------------------------------------------------------------------
# Generators
# --------------------------------------------------------------------------------------
def matches(name:str, patterns:Iterable[str]) -> bool:
    if not patterns: return True
    nl=name.lower()
    return any(p.lower() in nl for p in patterns)

def generate_fixture_wavs(filters:Iterable[str]=()):
    frames = int(RATE*DURATION_SECONDS)
    for cfg in FIXTURE_CONFIGS:
        cd, bd, ch, ed = cfg['codec'], cfg['bit_depth'], cfg['channels'], cfg['endian']
        fmt = FORMAT_TAGS[cd]; sw=bd//8; ba=ch*sw; ds=frames*ba
        name=f"sine_{cd}_{bd}bit_{endian_str(ed)}_{channel_str(ch)}.wav"
        if not matches(name,filters): continue
        path=OUTPUT_DIR/name; path.parent.mkdir(parents=True,exist_ok=True)
        with open(path,'wb') as f:
            write_wav_header(f,endian=ed,format_tag=fmt,channels=ch,sample_rate=RATE,bit_depth=bd,data_size=ds,fact_num_samples=(frames if fmt!=1 else None))
            for i in range(frames):
                val=math.sin(2*math.pi*i*FREQUENCY/RATE)*AMPLITUDE
                lin16=int(val*32767)
                for _ in range(ch):
                    if cd=='pcm':
                        if bd==8: f.write(struct.pack('B',int((val+1)*127.5)))
                        elif bd==24: f.write((max(min(int(val*8388607),8388607),-8388608)).to_bytes(3,byteorder=ed,signed=True))
                        else: f.write(struct.pack(( '<' if ed=='little' else '>')+('h' if bd==16 else 'i'),int(val*((1<<(bd-1))-1))))
                    elif cd=='float': f.write(struct.pack(( '<' if ed=='little' else '>')+('f' if bd==32 else 'd'),val))
                    elif cd=='alaw': f.write(struct.pack('B',linear_to_alaw(lin16)))
                    elif cd=='ulaw': f.write(struct.pack('B',linear_to_ulaw(lin16)))
        record_manifest(name,channels=ch,sample_rate=RATE,bit_depth=bd,format_tag=fmt,samples_per_channel=frames)

def generate_sweep_wavs(filters:Iterable[str]=()):
    frames=int(RATE*DURATION_SECONDS)
    for cfg in SWEEP_CONFIGS:
        cd, bd, ch, ed = cfg['codec'], cfg['bit_depth'], cfg['channels'], cfg['endian']
        fmt = FORMAT_TAGS[cd] if cd!='float' else 3; sw=bd//8; ba=ch*sw; ds=frames*ba
        name=f"sweep_{cd}_{bd}bit_{endian_str(ed)}_{channel_str(ch)}.wav"
        if not matches(name,filters): continue
        path=OUTPUT_DIR/name; path.parent.mkdir(parents=True,exist_ok=True)
        with open(path,'wb') as f:
            write_wav_header(f,endian=ed,format_tag=fmt,channels=ch,sample_rate=RATE,bit_depth=bd,data_size=ds)
            for i in range(frames):
                t=i/RATE
                freq=START_FREQ*((END_FREQ/START_FREQ)**(t/DURATION_SECONDS))
                for _ in range(ch):
                    val=math.sin(2*math.pi*t*(freq)) * AMPLITUDE
                    if cd=='pcm':
                        if bd==24: f.write((max(min(int(val*8388607),8388607),-8388608)).to_bytes(3,byteorder=ed,signed=True))
                        else: f.write(struct.pack(( '<' if ed=='little' else '>')+('h' if bd==16 else 'i'),int(val*((1<<(bd-1))-1))))
                    else: f.write(struct.pack(( '<' if ed=='little' else '>')+('f' if bd==32 else 'd'),val))
        record_manifest(name,channels=ch,sample_rate=RATE,bit_depth=bd,format_tag=fmt,samples_per_channel=frames)

def generate_exotic_wavs(filters:Iterable[str]=()):
    def save_pcm16(name, data, ch=1):
        if not matches(name,filters): return
        db=data.tobytes()
        hdr=struct.pack('<4sIHHIIHH',b'fmt ',16,1,ch,RATE,RATE*2*ch,2*ch,16)
        riff=struct.pack('<4sI4s',b'RIFF',36+len(db),b'WAVE')
        with open(OUTPUT_DIR/name,'wb') as wf:
            wf.write(riff+hdr+struct.pack('<4sI',b'data',len(db))+db)
        record_manifest(name,channels=ch,sample_rate=RATE,bit_depth=16,format_tag=1,samples_per_channel=(len(data)//ch))

    silent=np.zeros(RATE,dtype=np.int16); save_pcm16('exotic_silent_pcm16_mono.wav',silent)
    clipped=(np.ones(RATE)*32767).astype(np.int16); save_pcm16('exotic_clipped_pcm16_mono.wav',clipped)
    alt=np.zeros((RATE,2),dtype=np.int16); alt[:,0]=32767; save_pcm16('exotic_alt_clipped_silent_stereo.wav',alt,2)
    short=np.linspace(-1,1,80,dtype=np.float32); save_pcm16('exotic_short_pcm16_80samples.wav',(short*32767).astype(np.int16))
    naninf=np.zeros(RATE,dtype=np.float32); naninf[100:110]=np.nan; naninf[200:210]=np.inf
    db=naninf.tobytes(); hdr=struct.pack('<4sIHHIIHH',b'fmt ',16,3,1,RATE,RATE*4,4,32)
    riff=struct.pack('<4sI4s',b'RIFF',36+len(db),b'WAVE')
    with open(OUTPUT_DIR/'exotic_float32_nan_inf.wav','wb') as wf: wf.write(riff+hdr+struct.pack('<4sI',b'data',len(db))+db)
    record_manifest('exotic_float32_nan_inf.wav',channels=1,sample_rate=RATE,bit_depth=32,format_tag=3,samples_per_channel=RATE)

# --------------------------------------------------------------------------------------
# CLI & main
# --------------------------------------------------------------------------------------
def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument('--output',default=str(OUTPUT_DIR))
    p.add_argument('--duration',type=float,default=DURATION_SECONDS)
    p.add_argument('--rate',type=int,default=RATE)
    p.add_argument('--amp',type=float,default=AMPLITUDE)
    p.add_argument('--freq',type=float,default=FREQUENCY)
    p.add_argument('--only',nargs='*',default=[])
    p.add_argument('--skip',nargs='*',default=[])
    p.add_argument('--no-sine',action='store_true')
    p.add_argument('--no-sweep',action='store_true')
    p.add_argument('--no-exotic',action='store_true')
    return p.parse_args()

def main():
    args=parse_args()
    global OUTPUT_DIR,DURATION_SECONDS,RATE,AMPLITUDE,FREQUENCY
    OUTPUT_DIR=Path(args.output); DURATION_SECONDS=args.duration
    RATE=args.rate; AMPLITUDE=args.amp; FREQUENCY=args.freq
    OUTPUT_DIR.mkdir(parents=True,exist_ok=True)
    only=set(args.only)
    skip=set(args.skip)
    filters=[f for f in args.only]
    if not args.no_sine: generate_fixture_wavs(filters)
    if not args.no_sweep: generate_sweep_wavs(filters)
    if not args.no_exotic: generate_exotic_wavs(filters)
    with open(OUTPUT_DIR/'manifest.json','w') as mf: json.dump(MANIFEST,mf,indent=2)
    print('Wrote manifest:',OUTPUT_DIR/'manifest.json')

if __name__=='__main__': main()
