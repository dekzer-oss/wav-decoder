#include "decoder.h"
#include <wasm_simd128.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <limits.h>

// Global SIMD constants
static v128_t SCALE_I32, SCALE_I24, SCALE_I16, SCALE_U8;
static v128_t BIAS_U8, ONE, MINUS_ONE;

// Lookup tables for A-law and μ-law
static float ALAW_TABLE[256];
static float ULAW_TABLE[256];

// IMA ADPCM tables
static const int32_t IMA_STEP_TABLE[89] = {
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
    11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767
};

static const int8_t IMA_INDEX_TABLE[16] = {
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
};

// Maximum supported values for validation
#define MAX_CHANNELS 8
#define MAX_SAMPLE_RATE 384000
#define MAX_BITS_PER_SAMPLE 64
#define MAX_CHUNK_SIZE (100 * 1024 * 1024) // 100MB
#define MIN_HEADER_SIZE 44

__attribute__((constructor))
static void init_decoder() {
    // Initialize SIMD scaling constants
    SCALE_I32 = wasm_f32x4_splat(1.0f / 2147483648.0f);
    SCALE_I24 = wasm_f32x4_splat(1.0f / 8388608.0f);
    SCALE_I16 = wasm_f32x4_splat(1.0f / 32768.0f);
    SCALE_U8  = wasm_f32x4_splat(1.0f / 128.0f);
    BIAS_U8   = wasm_f32x4_splat(-128.0f);
    ONE       = wasm_f32x4_splat(1.0f);
    MINUS_ONE = wasm_f32x4_splat(-1.0f);

    // Initialize A-law and μ-law lookup tables
    for (int i = 0; i < 256; i++) {
        // A-law decoding
        int x_alaw = i ^ 0x55;
        int s_alaw = (x_alaw & 0x80) ? -1 : 1;
        int e_alaw = (x_alaw >> 4) & 0x07;
        int m_alaw = x_alaw & 0x0F;
        int y_alaw = (e_alaw == 0) ? (m_alaw << 4) + 8 : ((1 << 4) | m_alaw) << (e_alaw + 3);
        ALAW_TABLE[i] = s_alaw * (float)y_alaw / 32768.0f;

        // μ-law decoding
        int x_ulaw = ~i;
        int s_ulaw = (x_ulaw & 0x80) ? -1 : 1;
        int e_ulaw = (x_ulaw >> 4) & 0x07;
        int m_ulaw = x_ulaw & 0x0F;
        int y_ulaw = ((33 + (m_ulaw << 1)) << e_ulaw) - 33;
        ULAW_TABLE[i] = s_ulaw * (float)y_ulaw / 8031.0f;
    }
}

static inline int32_t read_i24_le(const uint8_t* p) {
    uint32_t val = p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16);
    return (val & 0x800000) ? (int32_t)(val | 0xFF000000) : (int32_t)val;
}

static inline uint32_t read_u32_le(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static inline uint16_t read_u16_le(const uint8_t* p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static inline int check_bounds(uint32_t offset, uint32_t size, uint32_t data_size) {
    if (offset > data_size || size > data_size) return 0;
    if (offset > data_size - size) return 0;
    return 1;
}

int parse_header(const uint8_t* data, uint32_t data_size, WavHeader* header) {
    if (!data || !header || data_size < MIN_HEADER_SIZE) {
        return 0;
    }
    if (memcmp(data, "RIFF", 4) != 0 || memcmp(data + 8, "WAVE", 4) != 0) {
        return 0;
    }
    uint32_t file_size = read_u32_le(data + 4);
    if (file_size < 36 || file_size > data_size - 8) {
        return 0;
    }

    memset(header, 0, sizeof(WavHeader));
    uint32_t offset = 12;
    int found_fmt = 0;
    int found_data = 0;

    while (offset + 8 <= data_size && (!found_fmt || !found_data)) {
        if (!check_bounds(offset, 8, data_size)) break;

        char chunk_id[5];
        memcpy(chunk_id, data + offset, 4);
        chunk_id[4] = '\0';
        uint32_t chunk_size = read_u32_le(data + offset + 4);

        if (chunk_size > MAX_CHUNK_SIZE || !check_bounds(offset + 8, chunk_size, data_size)) {
            if (strcmp(chunk_id, "fmt ") == 0 || strcmp(chunk_id, "data") == 0) {
                return 0;
            }
            uint32_t skip = 8;
            if (offset <= UINT32_MAX - skip) {
                offset += skip;
                continue;
            } else {
                break;
            }
        }

        if (strcmp(chunk_id, "fmt ") == 0) {
            if (chunk_size < 16) return 0;
            const uint8_t* fmt_data = data + offset + 8;
            header->audio_format    = read_u16_le(fmt_data);
            header->num_channels    = read_u16_le(fmt_data + 2);
            header->sample_rate     = read_u32_le(fmt_data + 4);
            header->byte_rate       = read_u32_le(fmt_data + 8);
            header->block_align     = read_u16_le(fmt_data + 12);
            header->bits_per_sample = read_u16_le(fmt_data + 14);

            if (header->num_channels == 0 || header->num_channels > MAX_CHANNELS ||
                header->sample_rate == 0 || header->sample_rate > MAX_SAMPLE_RATE ||
                header->block_align == 0 ||
                header->bits_per_sample == 0 || header->bits_per_sample > MAX_BITS_PER_SAMPLE) {
                return 0;
            }

            if (header->audio_format == 1) {
                uint32_t expected_block_align = (header->num_channels * header->bits_per_sample + 7) / 8;
                if (header->block_align != expected_block_align) return 0;
                uint32_t expected_byte_rate = header->sample_rate * header->block_align;
                if (header->byte_rate != expected_byte_rate) return 0;
            }
            found_fmt = 1;
        }
        else if (strcmp(chunk_id, "data") == 0) {
            header->data_chunk_pos  = offset + 8;
            header->data_chunk_size = chunk_size;
            found_data = 1;
        }

        uint32_t padded_size = (chunk_size + 1) & ~1U;
        if (offset > UINT32_MAX - 8 - padded_size) return 0;
        offset += 8 + padded_size;
    }
    return (found_fmt && found_data) ? 1 : 0;
}

// Input validation macros
#define VALIDATE_INPUTS(in, out, n) \
    do { \
        if (!(in) || !(out) || (n) <= 0 || (n) > INT_MAX/16) return; \
    } while(0)

#define VALIDATE_STEREO_INPUTS(in, left, right, n) \
    do { \
        if (!(in) || !(left) || !(right) || (n) <= 0 || (n) > INT_MAX/16) return; \
    } while(0)

void decode_pcm24_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);

    for (; i < end; i += step) {
        const uint8_t* p = in + i * 3;
        int32_t s0 = read_i24_le(p);
        int32_t s1 = read_i24_le(p + 3);
        int32_t s2 = read_i24_le(p + 6);
        int32_t s3 = read_i24_le(p + 9);

        v128_t v = wasm_v8x16_make(s0, s1, s2, s3);
        v128_t f = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(v), SCALE_I24);
        wasm_v128_store(out + i, f);
    }

    for (; i < n; i++) {
        out[i] = (float)read_i24_le(in + i * 3) / 8388608.0f;
    }
}

void decode_pcm24_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);

    for (; i < end; i += step) {
        const uint8_t* p = in + i * 6;
        int32_t l0 = read_i24_le(p);
        int32_t r0 = read_i24_le(p + 3);
        int32_t l1 = read_i24_le(p + 6);
        int32_t r1 = read_i24_le(p + 9);
        int32_t l2 = read_i24_le(p + 12);
        int32_t r2 = read_i24_le(p + 15);
        int32_t l3 = read_i24_le(p + 18);
        int32_t r3 = read_i24_le(p + 21);

        v128_t lv = wasm_v8x16_make(l0, l1, l2, l3);
        v128_t rv = wasm_v8x16_make(r0, r1, r2, r3);

        v128_t lf = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(lv), SCALE_I24);
        v128_t rf = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(rv), SCALE_I24);

        wasm_v128_store(left + i, lf);
        wasm_v128_store(right + i, rf);
    }

    for (; i < n; i++) {
        const uint8_t* p = in + i * 6;
        left[i] = (float)read_i24_le(p) / 8388608.0f;
        right[i] = (float)read_i24_le(p + 3) / 8388608.0f;
    }
}

void decode_float64_stereo(const double* __restrict__ in, float* __restrict__ left, float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 2;
    const int end = n - (n % step);

    for (; i < end; i += step) {
        v128_t in0 = wasm_v128_load(in + i * 2);
        v128_t in1 = wasm_v128_load(in + i * 2 + 2);
        v128_t ld = wasm_i64x2_shuffle(in0, in1, 0, 2);
        v128_t rd = wasm_i64x2_shuffle(in0, in1, 1, 3);
        v128_t lf = wasm_f32x4_demote_f64x2_zero(ld);
        v128_t rf = wasm_f32x4_demote_f64x2_zero(rd);
        lf = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, lf));
        rf = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, rf));

        // ✅ Fix: Use 32-bit lane stores to avoid overflow
        wasm_v128_store32_lane(left + i,     lf, 0);
        wasm_v128_store32_lane(left + i + 1, lf, 1);
        wasm_v128_store32_lane(right + i,    rf, 0);
        wasm_v128_store32_lane(right + i + 1,rf, 1);
    }

    for (; i < n; i++) {
        double l = in[i * 2];
        double r = in[i * 2 + 1];
        if (l != l) l = 0.0;
        if (r != r) r = 0.0;
        left[i] = fminf(1.0f, fmaxf(-1.0f, (float)l));
        right[i] = fminf(1.0f, fmaxf(-1.0f, (float)r));
    }
}

void decode_pcm8_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 16;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t bytes = wasm_v128_load(in + i);
        v128_t low_u16 = wasm_u16x8_extend_low_u8x16(bytes);
        v128_t high_u16 = wasm_u16x8_extend_high_u8x16(bytes);
        v128_t f0 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(low_u16));
        v128_t f1 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(low_u16));
        v128_t f2 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(high_u16));
        v128_t f3 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(high_u16));
        f0 = wasm_f32x4_mul(wasm_f32x4_add(f0, BIAS_U8), SCALE_U8);
        f1 = wasm_f32x4_mul(wasm_f32x4_add(f1, BIAS_U8), SCALE_U8);
        f2 = wasm_f32x4_mul(wasm_f32x4_add(f2, BIAS_U8), SCALE_U8);
        f3 = wasm_f32x4_mul(wasm_f32x4_add(f3, BIAS_U8), SCALE_U8);
        wasm_v128_store(out + i + 0, f0);
        wasm_v128_store(out + i + 4, f1);
        wasm_v128_store(out + i + 8, f2);
        wasm_v128_store(out + i + 12, f3);
    }
    for (; i < n; i++) {
        out[i] = ((float)in[i] - 128.0f) / 128.0f;
    }
}

void decode_pcm16_mono(const int16_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 8;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t samples_i16 = wasm_v128_load(in + i);
        v128_t low_i32 = wasm_i32x4_extend_low_i16x8(samples_i16);
        v128_t high_i32 = wasm_i32x4_extend_high_i16x8(samples_i16);
        v128_t f0 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(low_i32), SCALE_I16);
        v128_t f1 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(high_i32), SCALE_I16);
        wasm_v128_store(out + i, f0);
        wasm_v128_store(out + i + 4, f1);
    }
    for (; i < n; i++) {
        out[i] = (float)in[i] / 32768.0f;
    }
}

void decode_pcm32_mono(const int32_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t samples_i32 = wasm_v128_load(in + i);
        v128_t result = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(samples_i32), SCALE_I32);
        wasm_v128_store(out + i, result);
    }
    for (; i < n; i++) {
        out[i] = (float)in[i] / 2147483648.0f;
    }
}

void decode_float32_mono(const float* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t input = wasm_v128_load(in + i);
        v128_t clamped = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, input));
        wasm_v128_store(out + i, clamped);
    }
    for (; i < n; i++) {
        float val = in[i];
        if (val != val) val = 0.0f;
        out[i] = fminf(1.0f, fmaxf(-1.0f, val));
    }
}

void decode_float64_mono(const double* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t d0_pair = wasm_v128_load(in + i);
        v128_t d1_pair = wasm_v128_load(in + i + 2);
        v128_t f0_demoted = wasm_f32x4_demote_f64x2_zero(d0_pair);
        v128_t f1_demoted = wasm_f32x4_demote_f64x2_zero(d1_pair);
        v128_t combined = wasm_i32x4_shuffle(f0_demoted, f1_demoted, 0, 1, 4, 5);
        v128_t clamped = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, combined));
        wasm_v128_store(out + i, clamped);
    }
    for (; i < n; i++) {
        double val = in[i];
        if (val != val) val = 0.0;
        out[i] = fminf(1.0f, fmaxf(-1.0f, (float)val));
    }
}

void decode_alaw_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 16;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        const uint8_t* p = in + i;
        v128_t v0 = wasm_f32x4_make(ALAW_TABLE[p[0]], ALAW_TABLE[p[1]], ALAW_TABLE[p[2]], ALAW_TABLE[p[3]]);
        v128_t v1 = wasm_f32x4_make(ALAW_TABLE[p[4]], ALAW_TABLE[p[5]], ALAW_TABLE[p[6]], ALAW_TABLE[p[7]]);
        v128_t v2 = wasm_f32x4_make(ALAW_TABLE[p[8]], ALAW_TABLE[p[9]], ALAW_TABLE[p[10]], ALAW_TABLE[p[11]]);
        v128_t v3 = wasm_f32x4_make(ALAW_TABLE[p[12]], ALAW_TABLE[p[13]], ALAW_TABLE[p[14]], ALAW_TABLE[p[15]]);
        wasm_v128_store(out + i + 0, v0);
        wasm_v128_store(out + i + 4, v1);
        wasm_v128_store(out + i + 8, v2);
        wasm_v128_store(out + i + 12, v3);
    }
    for (; i < n; i++) {
        out[i] = ALAW_TABLE[in[i]];
    }
}

void decode_alaw_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                       float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 8;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        const uint8_t* p = in + i * 2;
        v128_t l0 = wasm_f32x4_make(ALAW_TABLE[p[0]], ALAW_TABLE[p[2]], ALAW_TABLE[p[4]], ALAW_TABLE[p[6]]);
        v128_t l1 = wasm_f32x4_make(ALAW_TABLE[p[8]], ALAW_TABLE[p[10]], ALAW_TABLE[p[12]], ALAW_TABLE[p[14]]);
        v128_t r0 = wasm_f32x4_make(ALAW_TABLE[p[1]], ALAW_TABLE[p[3]], ALAW_TABLE[p[5]], ALAW_TABLE[p[7]]);
        v128_t r1 = wasm_f32x4_make(ALAW_TABLE[p[9]], ALAW_TABLE[p[11]], ALAW_TABLE[p[13]], ALAW_TABLE[p[15]]);
        wasm_v128_store(left + i + 0, l0);
        wasm_v128_store(left + i + 4, l1);
        wasm_v128_store(right + i + 0, r0);
        wasm_v128_store(right + i + 4, r1);
    }
    for (; i < n; i++) {
        left[i] = ALAW_TABLE[in[i * 2]];
        right[i] = ALAW_TABLE[in[i * 2 + 1]];
    }
}

void decode_ulaw_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n) {
    VALIDATE_INPUTS(in, out, n);
    int i = 0;
    const int step = 16;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        const uint8_t* p = in + i;
        v128_t v0 = wasm_f32x4_make(ULAW_TABLE[p[0]], ULAW_TABLE[p[1]], ULAW_TABLE[p[2]], ULAW_TABLE[p[3]]);
        v128_t v1 = wasm_f32x4_make(ULAW_TABLE[p[4]], ULAW_TABLE[p[5]], ULAW_TABLE[p[6]], ULAW_TABLE[p[7]]);
        v128_t v2 = wasm_f32x4_make(ULAW_TABLE[p[8]], ULAW_TABLE[p[9]], ULAW_TABLE[p[10]], ULAW_TABLE[p[11]]);
        v128_t v3 = wasm_f32x4_make(ULAW_TABLE[p[12]], ULAW_TABLE[p[13]], ULAW_TABLE[p[14]], ULAW_TABLE[p[15]]);
        wasm_v128_store(out + i + 0, v0);
        wasm_v128_store(out + i + 4, v1);
        wasm_v128_store(out + i + 8, v2);
        wasm_v128_store(out + i + 12, v3);
    }
    for (; i < n; i++) {
        out[i] = ULAW_TABLE[in[i]];
    }
}

void decode_ulaw_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                       float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 8;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        const uint8_t* p = in + i * 2;
        v128_t l0 = wasm_f32x4_make(ULAW_TABLE[p[0]], ULAW_TABLE[p[2]], ULAW_TABLE[p[4]], ULAW_TABLE[p[6]]);
        v128_t l1 = wasm_f32x4_make(ULAW_TABLE[p[8]], ULAW_TABLE[p[10]], ULAW_TABLE[p[12]], ULAW_TABLE[p[14]]);
        v128_t r0 = wasm_f32x4_make(ULAW_TABLE[p[1]], ULAW_TABLE[p[3]], ULAW_TABLE[p[5]], ULAW_TABLE[p[7]]);
        v128_t r1 = wasm_f32x4_make(ULAW_TABLE[p[9]], ULAW_TABLE[p[11]], ULAW_TABLE[p[13]], ULAW_TABLE[p[15]]);
        wasm_v128_store(left + i + 0, l0);
        wasm_v128_store(left + i + 4, l1);
        wasm_v128_store(right + i + 0, r0);
        wasm_v128_store(right + i + 4, r1);
    }
    for (; i < n; i++) {
        left[i] = ULAW_TABLE[in[i * 2]];
        right[i] = ULAW_TABLE[in[i * 2 + 1]];
    }
}

static inline int32_t clamp_i32(int32_t val, int32_t min, int32_t max) {
    return (val < min) ? min : (val > max) ? max : val;
}

void decode_ima_adpcm_mono(
const uint8_t* __restrict__ in,
float* __restrict__ out,
int n_blocks,
int samples_per_block
) {
    if (!in || !out || n_blocks <= 0 || samples_per_block <= 0 || samples_per_block % 2 != 0) {
        return;
    }
    const float scale = 1.0f / 32768.0f;
    const uint8_t* block_ptr = in;
    float* out_ptr = out;
    for (int block = 0; block < n_blocks; block++) {
        int32_t predictor = (int16_t)(block_ptr[0] | (block_ptr[1] << 8));
        int step_index = clamp_i32(block_ptr[2], 0, 88);
        const uint8_t* data_ptr = block_ptr + 4;
        for (int i = 0; i < (samples_per_block / 2); i++) {
            uint8_t byte = data_ptr[i];
            uint8_t nibble_low = byte & 0x0F;
            uint8_t nibble_high = byte >> 4;
            int32_t step = IMA_STEP_TABLE[step_index];
            int32_t diff = step >> 3;
            if (nibble_low & 4) diff += step;
            if (nibble_low & 2) diff += step >> 1;
            if (nibble_low & 1) diff += step >> 2;
            predictor += (nibble_low & 8) ? -diff : diff;
            predictor = clamp_i32(predictor, -32768, 32767);
            step_index = clamp_i32(step_index + IMA_INDEX_TABLE[nibble_low], 0, 88);
            out_ptr[i * 2] = (float)predictor * scale;
            step = IMA_STEP_TABLE[step_index];
            diff = step >> 3;
            if (nibble_high & 4) diff += step;
            if (nibble_high & 2) diff += step >> 1;
            if (nibble_high & 1) diff += step >> 2;
            predictor += (nibble_high & 8) ? -diff : diff;
            predictor = clamp_i32(predictor, -32768, 32767);
            step_index = clamp_i32(step_index + IMA_INDEX_TABLE[nibble_high], 0, 88);
            out_ptr[i * 2 + 1] = (float)predictor * scale;
        }
        block_ptr += 4 + samples_per_block / 2;
        out_ptr += samples_per_block;
    }
}

void decode_ima_adpcm_stereo(
    const uint8_t* __restrict__ in,
    float* __restrict__ left,
    float* __restrict__ right,
    int n_blocks,
    int samples_per_block
) {
    if (!in || !left || !right || n_blocks <= 0 || samples_per_block <= 0) {
        return;
    }
    const float scale = 1.0f / 32768.0f;
    const uint8_t* block_ptr = in;
    float* lp = left;
    float* rp = right;
    for (int blk = 0; blk < n_blocks; ++blk) {
        int32_t pred_l = (int16_t)(block_ptr[0] | (block_ptr[1] << 8));
        int idx_l = clamp_i32(block_ptr[2], 0, 88);
        int32_t pred_r = (int16_t)(block_ptr[4] | (block_ptr[5] << 8));
        int idx_r = clamp_i32(block_ptr[6], 0, 88);
        const uint8_t* data = block_ptr + 8;
        for (int s = 0; s < samples_per_block; ++s) {
            uint8_t b = data[s];
            uint32_t nl = (uint32_t)(b & 0x0F);
            uint32_t nr = (uint32_t)(b >> 4);
            int step_l = IMA_STEP_TABLE[idx_l];
            int diff_l = step_l >> 3;
            if (nl & 4) diff_l += step_l;
            if (nl & 2) diff_l += (step_l >> 1);
            if (nl & 1) diff_l += (step_l >> 2);
            int sign_l = (nl & 8) ? -1 : 1;
            pred_l = clamp_i32(pred_l + sign_l * diff_l, -32768, 32767);
            idx_l = clamp_i32(idx_l + IMA_INDEX_TABLE[nl], 0, 88);
            lp[s] = (float)pred_l * scale;
            int step_r = IMA_STEP_TABLE[idx_r];
            int diff_r = step_r >> 3;
            if (nr & 4) diff_r += step_r;
            if (nr & 2) diff_r += (step_r >> 1);
            if (nr & 1) diff_r += (step_r >> 2);
            int sign_r = (nr & 8) ? -1 : 1;
            pred_r = clamp_i32(pred_r + sign_r * diff_r, -32768, 32767);
            idx_r = clamp_i32(idx_r + IMA_INDEX_TABLE[nr], 0, 88);
            rp[s] = (float)pred_r * scale;
        }
        block_ptr += 8 + samples_per_block;
        lp += samples_per_block;
        rp += samples_per_block;
    }
}

void decode_pcm8_stereo(
    const uint8_t* __restrict__ in,
    float* __restrict__ left,
    float* __restrict__ right,
    int n
) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 16;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t in0 = wasm_v128_load(in + i * 2);
        v128_t in1 = wasm_v128_load(in + i * 2 + 16);
        v128_t left_u8 = wasm_i8x16_shuffle(in0, in1, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30);
        v128_t right_u8 = wasm_i8x16_shuffle(in0, in1, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31);
        v128_t l_u16_lo = wasm_u16x8_extend_low_u8x16(left_u8);
        v128_t l_u16_hi = wasm_u16x8_extend_high_u8x16(left_u8);
        v128_t r_u16_lo = wasm_u16x8_extend_low_u8x16(right_u8);
        v128_t r_u16_hi = wasm_u16x8_extend_high_u8x16(right_u8);
        v128_t l0 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(l_u16_lo));
        v128_t l1 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(l_u16_lo));
        v128_t l2 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(l_u16_hi));
        v128_t l3 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(l_u16_hi));
        v128_t r0 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(r_u16_lo));
        v128_t r1 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(r_u16_lo));
        v128_t r2 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_low_u16x8(r_u16_hi));
        v128_t r3 = wasm_f32x4_convert_u32x4(wasm_u32x4_extend_high_u16x8(r_u16_hi));
        l0 = wasm_f32x4_mul(wasm_f32x4_add(l0, BIAS_U8), SCALE_U8);
        l1 = wasm_f32x4_mul(wasm_f32x4_add(l1, BIAS_U8), SCALE_U8);
        l2 = wasm_f32x4_mul(wasm_f32x4_add(l2, BIAS_U8), SCALE_U8);
        l3 = wasm_f32x4_mul(wasm_f32x4_add(l3, BIAS_U8), SCALE_U8);
        r0 = wasm_f32x4_mul(wasm_f32x4_add(r0, BIAS_U8), SCALE_U8);
        r1 = wasm_f32x4_mul(wasm_f32x4_add(r1, BIAS_U8), SCALE_U8);
        r2 = wasm_f32x4_mul(wasm_f32x4_add(r2, BIAS_U8), SCALE_U8);
        r3 = wasm_f32x4_mul(wasm_f32x4_add(r3, BIAS_U8), SCALE_U8);
        wasm_v128_store(left + i + 0, l0);
        wasm_v128_store(left + i + 4, l1);
        wasm_v128_store(left + i + 8, l2);
        wasm_v128_store(left + i + 12, l3);
        wasm_v128_store(right + i + 0, r0);
        wasm_v128_store(right + i + 4, r1);
        wasm_v128_store(right + i + 8, r2);
        wasm_v128_store(right + i + 12, r3);
    }
    for (; i < n; i++) {
        left[i] = ((float)in[i * 2] - 128.0f) / 128.0f;
        right[i] = ((float)in[i * 2 + 1] - 128.0f) / 128.0f;
    }
}

void decode_pcm16_stereo(const int16_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 8;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t in0 = wasm_v128_load(in + i * 2);
        v128_t in1 = wasm_v128_load(in + i * 2 + 8);
        v128_t left_i16 = wasm_i16x8_shuffle(in0, in1, 0, 2, 4, 6, 8, 10, 12, 14);
        v128_t right_i16 = wasm_i16x8_shuffle(in0, in1, 1, 3, 5, 7, 9, 11, 13, 15);
        v128_t left_lo_i32 = wasm_i32x4_extend_low_i16x8(left_i16);
        v128_t left_hi_i32 = wasm_i32x4_extend_high_i16x8(left_i16);
        v128_t right_lo_i32 = wasm_i32x4_extend_low_i16x8(right_i16);
        v128_t right_hi_i32 = wasm_i32x4_extend_high_i16x8(right_i16);
        v128_t left_f0 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(left_lo_i32), SCALE_I16);
        v128_t left_f1 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(left_hi_i32), SCALE_I16);
        v128_t right_f0 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(right_lo_i32), SCALE_I16);
        v128_t right_f1 = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(right_hi_i32), SCALE_I16);
        wasm_v128_store(left + i + 0, left_f0);
        wasm_v128_store(left + i + 4, left_f1);
        wasm_v128_store(right + i + 0, right_f0);
        wasm_v128_store(right + i + 4, right_f1);
    }
    for (; i < n; i++) {
        left[i] = (float)in[i * 2] / 32768.0f;
        right[i] = (float)in[i * 2 + 1] / 32768.0f;
    }
}

void decode_pcm32_stereo(const int32_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t in0 = wasm_v128_load(in + i * 2);
        v128_t in1 = wasm_v128_load(in + i * 2 + 4);
        v128_t left_i32 = wasm_i32x4_shuffle(in0, in1, 0, 2, 4, 6);
        v128_t right_i32 = wasm_i32x4_shuffle(in0, in1, 1, 3, 5, 7);
        v128_t left_f = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(left_i32), SCALE_I32);
        v128_t right_f = wasm_f32x4_mul(wasm_f32x4_convert_i32x4(right_i32), SCALE_I32);
        wasm_v128_store(left + i, left_f);
        wasm_v128_store(right + i, right_f);
    }
    for (; i < n; i++) {
        left[i] = (float)in[i * 2] / 2147483648.0f;
        right[i] = (float)in[i * 2 + 1] / 2147483648.0f;
    }
}

void decode_float32_stereo(const float* __restrict__ in, float* __restrict__ left,
                          float* __restrict__ right, int n) {
    VALIDATE_STEREO_INPUTS(in, left, right, n);
    int i = 0;
    const int step = 4;
    const int end = n - (n % step);
    for (; i < end; i += step) {
        v128_t in0 = wasm_v128_load(in + i * 2);
        v128_t in1 = wasm_v128_load(in + i * 2 + 4);
        v128_t lf = wasm_i32x4_shuffle(in0, in1, 0, 2, 4, 6);
        v128_t rf = wasm_i32x4_shuffle(in0, in1, 1, 3, 5, 7);
        lf = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, lf));
        rf = wasm_f32x4_pmin(ONE, wasm_f32x4_pmax(MINUS_ONE, rf));
        wasm_v128_store(left + i, lf);
        wasm_v128_store(right + i, rf);
    }
    for (; i < n; i++) {
        float l = in[i * 2];
        float r = in[i * 2 + 1];
        if (l != l) l = 0.0f;
        if (r != r) r = 0.0f;
        left[i] = fminf(1.0f, fmaxf(-1.0f, l));
        right[i] = fminf(1.0f, fmaxf(-1.0f, r));
    }
}
