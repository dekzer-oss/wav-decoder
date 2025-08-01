export interface EvilFixtureExpectation {
  /** What’s broken? */
  desc: string;
  /** Substring to look for in errors/warnings (string, not RegExp) */
  expect: string;
}

/**
 * Simple map: <filename → {desc, expect}>
 */
export const evilFixtureExpectations: Record<string, EvilFixtureExpectation> = {
  'evil_small_riff.wav': {
    desc: 'RIFF size smaller than actual file',
    expect: 'RIFF size',
  },
  'evil_big_riff.wav': {
    desc: 'RIFF size greater than actual file',
    expect: 'RIFF size',
  },
  'evil_multi_data_chunks.wav': {
    desc: 'Multiple data chunks, one empty',
    expect: 'multiple data',
  },
  'evil_data_before_fmt.wav': {
    desc: 'data chunk before fmt chunk',
    expect: 'data chunk before fmt',
  },
  'evil_odd_chunk_size.wav': {
    desc: 'Chunk with odd size (needs padding)',
    expect: 'odd chunk',
  },
  'evil_truncated.wav': {
    desc: 'Truncated data chunk (claims more than available)',
    expect: 'truncated',
  },
  'evil_no_fmt_chunk.wav': {
    desc: 'Missing fmt chunk',
    expect: 'fmt',
  },
  'evil_no_data_chunk.wav': {
    desc: 'Missing data chunk',
    expect: 'data chunk',
  },
  'evil_zero_fmt_size.wav': {
    desc: 'fmt chunk with zero size',
    expect: 'fmt',
  },
  'evil_tiny_fmt.wav': {
    desc: 'fmt chunk <16 bytes',
    expect: 'fmt',
  },
  'evil_bad_format_tag.wav': {
    desc: 'Unsupported format tag',
    expect: 'unsupported audio format',
  },
  'evil_zero_channels.wav': {
    desc: 'Zero channels in fmt',
    expect: 'zero',
  },
  'evil_extreme_channels.wav': {
    desc: 'Unreasonably high channel count',
    expect: 'channel',
  },
  'evil_zero_sample_rate.wav': {
    desc: 'Zero sample rate',
    expect: 'zero',
  },
  'evil_bad_bit_depth.wav': {
    desc: 'Invalid bit depth',
    expect: 'bit depth',
  },
  'evil_bad_block_align.wav': {
    desc: 'Block align mismatch',
    expect: 'blockAlign',
  },
  'evil_mixed_endian.wav': {
    desc: 'Mixed endianness (RIFX + LE chunks)',
    expect: 'big endian',
  },
  'evil_bad_chunk_id.wav': {
    desc: "Corrupt chunk id (e.g., 'fmx ')",
    expect: 'fmt',
  },
  'evil_oversized_chunk.wav': {
    desc: 'Data chunk claims to extend beyond file end',
    expect: 'truncated',
  },
  'evil_empty_file.wav': {
    desc: 'Completely empty file',
    expect: 'header',
  },
  'evil_just_riff.wav': {
    desc: "Only 'RIFF', nothing else",
    expect: 'header',
  },
  'evil_bad_wave_signature.wav': {
    desc: 'Bad WAVE signature',
    expect: 'WAVE',
  },
  'evil_nested_chunks.wav': {
    desc: 'LIST chunk with nested RIFF',
    expect: 'LIST',
  },
  'evil_float_fmt_int_data.wav': {
    desc: 'Float format but data is int',
    expect: 'data',
  },
};
