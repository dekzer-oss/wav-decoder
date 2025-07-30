#ifndef DECODER_H
#define DECODER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// WAV header structure
typedef struct {
    uint16_t audio_format;      // Audio format (1 = PCM, 6 = A-law, 7 = μ-law, etc.)
    uint16_t num_channels;      // Number of channels (1 = mono, 2 = stereo)
    uint32_t sample_rate;       // Sample rate in Hz
    uint32_t byte_rate;         // Byte rate (SampleRate * NumChannels * BitsPerSample/8)
    uint16_t block_align;       // Block alignment (NumChannels * BitsPerSample/8)
    uint16_t bits_per_sample;   // Bits per sample
    uint32_t data_chunk_pos;    // Position of data chunk in file
    uint32_t data_chunk_size;   // Size of data chunk in bytes
} WavHeader;

// Audio format constants
#define WAVE_FORMAT_PCM         1
#define WAVE_FORMAT_ADPCM       2
#define WAVE_FORMAT_IEEE_FLOAT  3
#define WAVE_FORMAT_ALAW        6
#define WAVE_FORMAT_MULAW       7
#define WAVE_FORMAT_IMA_ADPCM   17

// Function declarations

/**
 * Parse WAV file header and extract format information
 * @param data Pointer to WAV file data
 * @param data_size Size of WAV file data in bytes
 * @param header Pointer to WavHeader structure to fill
 * @return 1 on success, 0 on failure
 */
int parse_header(const uint8_t* data, uint32_t data_size, WavHeader* header);

// Mono decoders
void decode_pcm8_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n);
void decode_pcm16_mono(const int16_t* __restrict__ in, float* __restrict__ out, int n);
void decode_pcm24_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n);
void decode_pcm32_mono(const int32_t* __restrict__ in, float* __restrict__ out, int n);
void decode_float32_mono(const float* __restrict__ in, float* __restrict__ out, int n);
void decode_float64_mono(const double* __restrict__ in, float* __restrict__ out, int n);
void decode_alaw_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n);
void decode_ulaw_mono(const uint8_t* __restrict__ in, float* __restrict__ out, int n);

// Stereo decoders
void decode_pcm8_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                       float* __restrict__ right, int n);
void decode_pcm16_stereo(const int16_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n);
void decode_pcm24_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n);
void decode_pcm32_stereo(const int32_t* __restrict__ in, float* __restrict__ left,
                        float* __restrict__ right, int n);
void decode_float32_stereo(const float* __restrict__ in, float* __restrict__ left,
                          float* __restrict__ right, int n);
void decode_float64_stereo(const double* __restrict__ in, float* __restrict__ left,
                          float* __restrict__ right, int n);
void decode_alaw_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                       float* __restrict__ right, int n);
void decode_ulaw_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                       float* __restrict__ right, int n);

// IMA ADPCM decoders
void decode_ima_adpcm_mono(const uint8_t* __restrict__ in, float* __restrict__ out,
                          int n_blocks, int samples_per_block);
void decode_ima_adpcm_stereo(const uint8_t* __restrict__ in, float* __restrict__ left,
                            float* __restrict__ right, int n_blocks, int samples_per_block);

#ifdef __cplusplus
}
#endif

#endif // DECODER_H
