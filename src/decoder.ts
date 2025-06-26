import type {DecodedAudio, DecodeError, WavFormat} from "./types";

/**
 * A lightweight, dependency-free circular buffer for managing streaming data efficiently.
 */
export class CircularBuffer {
    public readonly capacity: number;
    private readonly buffer: Uint8Array;
    private writePos = 0;
    private readPos = 0;
    private _size = 0;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.buffer = new Uint8Array(capacity);
    }

    /** Number of bytes available to be read. */
    get available(): number {
        return this._size;
    }

    /** Available space for writing. */
    get freeSpace(): number {
        return this.capacity - this._size;
    }

    /**
     * Writes data to the buffer.
     * @param data The data to write.
     * @returns The number of bytes successfully written.
     */
    write(data: Uint8Array): number {
        if (data.length === 0) return 0;

        const bytesToWrite = Math.min(data.length, this.freeSpace);
        if (bytesToWrite === 0) return 0;

        const part1 = Math.min(bytesToWrite, this.capacity - this.writePos);
        const part2 = bytesToWrite - part1;

        this.buffer.set(data.subarray(0, part1), this.writePos);
        if (part2 > 0) {
            this.buffer.set(data.subarray(part1, part1 + part2), 0);
        }

        this.writePos = (this.writePos + bytesToWrite) % this.capacity;
        this._size += bytesToWrite;
        return bytesToWrite;
    }

    /**
     * Reads a specified number of bytes from the buffer.
     * @param length The number of bytes to read.
     * @returns A new Uint8Array with the data, or null if not enough data is available.
     */
    read(length: number): Uint8Array | null {
        if (length < 0) throw new RangeError("Length must be non-negative");
        if (length === 0) return new Uint8Array(0);

        if (this._size < length) return null;

        const result = new Uint8Array(length);
        const part1 = Math.min(length, this.capacity - this.readPos);
        const part2 = length - part1;

        result.set(this.buffer.subarray(this.readPos, this.readPos + part1), 0);
        if (part2 > 0) {
            result.set(this.buffer.subarray(0, part2), part1);
        }

        this.readPos = (this.readPos + length) % this.capacity;
        this._size -= length;
        return result;
    }

    /**
     * Peeks at the available data without consuming it.
     * @param length The number of bytes to peek at.
     * @returns A new Uint8Array with the data, correctly sized to available bytes if less than requested.
     */
    peek(length: number): Uint8Array | null {
        if (length < 0) throw new RangeError("Length must be non-negative");
        if (length === 0) return new Uint8Array(0);

        const bytesToPeek = Math.min(length, this._size);
        if (bytesToPeek === 0) return new Uint8Array(0);

        const result = new Uint8Array(bytesToPeek);
        const part1 = Math.min(bytesToPeek, this.capacity - this.readPos);
        const part2 = bytesToPeek - part1;

        result.set(this.buffer.subarray(this.readPos, this.readPos + part1), 0);
        if (part2 > 0) {
            result.set(this.buffer.subarray(0, part2), part1);
        }
        return result;
    }

    /** Clears the buffer. */
    clear(): void {
        this.writePos = 0;
        this.readPos = 0;
        this._size = 0;
    }
}

/**
 * @file WavStreamDecoder.ts
 * @module wav-stream-decoder
 * @description A robust, dependency-free, streaming WAV audio decoder for JavaScript.
 */

export enum State {
    UNINIT,
    DECODING,
    ENDED,
    ERROR,
}

interface ChunkInfo {
    id: string;
    size: number;
    offset: number;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

const KSDATAFORMAT_SUBTYPE_PCM = new Uint8Array([
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
    0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71
]);

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Uint8Array([
    0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
    0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71
]);

/**
 * A robust, dependency-free, streaming WAV audio decoder for JavaScript.
 * It supports PCM (8, 16, 24, 32-bit), IEEE Float (32, 64-bit), A-Law, and µ-Law formats.
 * It is designed to be highly resilient to malformed files and can be used in any JavaScript environment.
 */
export class WavStreamDecoder {
    private static readonly MAX_HEADER_SIZE = 1024 * 1024;
    private static readonly MAX_AUDIO_BUFFER_SIZE = 16 * 1024 * 1024;
    private static readonly MAX_CHANNELS = 32;
    private static readonly MAX_SAMPLE_RATE = 384000;

    private static readonly ALAW_TABLE: Float32Array = WavStreamDecoder.buildAlawTable();
    private static readonly MULAW_TABLE: Float32Array = WavStreamDecoder.buildMulawTable();

    private state = State.UNINIT;
    private audioBuffer: CircularBuffer;
    private format = {} as WavFormat;
    private bytesRemaining = 0;
    private totalBytes = 0;
    private readonly errors: DecodeError[] = [];
    private bytesDecoded = 0;
    private parsedChunks: ChunkInfo[] = [];
    private effectiveFormat = 0;
    private factSamples = 0;
    private isLittleEndian = true;
    private unhandledChunks: ChunkInfo[] = [];
    private pendingHeaderData = new Uint8Array(0);

    constructor() {
        this.audioBuffer = new CircularBuffer(WavStreamDecoder.MAX_AUDIO_BUFFER_SIZE);
    }

    public get info() {
        return {
            state: this.state,
            format: {...this.format},
            errors: [...this.errors],
            effectiveFormat: this.effectiveFormat,
            bytesDecoded: this.bytesDecoded,
            bytesRemaining: this.bytesRemaining,
            totalBytes: this.totalBytes,
            progress: this.totalBytes > 0 ? (this.totalBytes - this.bytesRemaining) / this.totalBytes : 0,
            parsedChunks: [...this.parsedChunks],
            unhandledChunks: [...this.unhandledChunks]
        };
    }

    public get estimatedSamples(): number {
        if (this.factSamples > 0) return this.factSamples;
        if (this.totalBytes > 0 && this.format.blockAlign > 0) {
            return Math.floor(this.totalBytes / this.format.blockAlign);
        }
        return 0;
    }

    private static buildMulawTable(): Float32Array {
        const MULAW_BIAS = 0x84; // 132
        const table = new Float32Array(256);

        for (let i = 0; i < 256; i++) {
            let muVal = ~i & 0xff;
            let sign = (muVal & 0x80) ? -1 : 1;
            let exponent = (muVal & 0x70) >> 4;
            let mantissa = muVal & 0x0f;

            let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
            sample -= MULAW_BIAS;

            table[i] = sign * sample / 32768;
        }
        return table;
    }

    private static buildAlawTable(): Float32Array {
        const table = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            let aVal = i ^ 0x55;
            let sign = (aVal & 0x80) ? -1 : 1;
            let exponent = (aVal & 0x70) >> 4;
            let mantissa = aVal & 0x0f;

            let sample: number;
            if (exponent === 0) {
                sample = (mantissa << 4) + 8;
            } else {
                sample = ((mantissa + 16) << (exponent + 3)) - 2048;
            }

            table[i] = sign * sample / 32768;
        }
        return table;
    }

    public free(): void {
        this.reset();
        this.state = State.ENDED;
    }

    public reset(): void {
        this.state = State.UNINIT;
        this.audioBuffer.clear();
        this.errors.length = 0;
        this.format = {} as WavFormat;
        this.bytesRemaining = this.bytesDecoded = this.totalBytes = this.factSamples = 0;
        this.parsedChunks = [];
        this.unhandledChunks = [];
        this.effectiveFormat = 0;
        this.isLittleEndian = true;
        this.pendingHeaderData = new Uint8Array(0);
    }

    public decode(chunk: Uint8Array): DecodedAudio {
        if (this.state === State.ENDED || this.state === State.ERROR) {
            return this.createErrorResult('Decoder is in a terminal state.');
        }

        try {
            if (this.state === State.UNINIT) {
                if (this.pendingHeaderData.length + chunk.length > WavStreamDecoder.MAX_HEADER_SIZE) {
                    this.state = State.ERROR;
                    return this.createErrorResult('Header size exceeds maximum limit.');
                }
                const combined = new Uint8Array(this.pendingHeaderData.length + chunk.length);
                combined.set(this.pendingHeaderData, 0);
                combined.set(chunk, this.pendingHeaderData.length);
                this.pendingHeaderData = combined;

                this.tryParseHeader();

                // Check the state *after* the parsing attempt.
                if (this.state === State.UNINIT) {
                    // Not an error, just needs more data.
                    return this.createEmptyResult();
                } else if (this.state === State.ERROR) {
                    // A fatal error occurred during parsing.
                    return {
                        channelData: [],
                        samplesDecoded: 0,
                        sampleRate: 0,
                        errors: [...this.errors]
                    };
                }
            } else {
                if (this.audioBuffer.write(chunk) < chunk.length) {
                    this.state = State.ERROR;
                    return this.createErrorResult('Audio buffer capacity exceeded.');
                }
            }

            return this.processBufferedFrames();
        } catch (err) {
            this.state = State.ERROR;
            const message = err instanceof Error ? err.message : String(err);
            this.errors.push(this.createError(`Decode error: ${message}`));
            return this.createErrorResult('Decode error');
        }
    }

    public decodeFrame(frame: Uint8Array): DecodedAudio {
        if (this.state !== State.DECODING) {
            return this.createErrorResult('Decoder must be initialized before decodeFrame().');
        }
        if (frame.length === 0) {
            return this.createEmptyResult();
        }
        if (this.format.blockAlign <= 0 || frame.length % this.format.blockAlign !== 0) {
            return this.createErrorResult('Data for decodeFrame must be a multiple of the frame size (blockAlign).');
        }

        try {
            const decoded = this._processAudioData(frame);
            this.bytesDecoded += frame.length;
            this.bytesRemaining = Math.max(0, this.bytesRemaining - frame.length);
            return decoded;
        } catch (err) {
            this.state = State.ERROR;
            const message = err instanceof Error ? err.message : String(err);
            this.errors.push(this.createError(`Frame decode error: ${message}`));
            return this.createErrorResult('Frame decode error');
        }
    }

    public async flush(): Promise<DecodedAudio | null> {
        if (this.state === State.ENDED || this.state === State.ERROR) return null;

        const result = this.processBufferedFrames();

        if (this.audioBuffer.available > 0) {
            this.errors.push(this.createError(`Discarded ${this.audioBuffer.available} bytes of incomplete final frame.`));
            this.bytesRemaining = Math.max(0, this.bytesRemaining - this.audioBuffer.available);
            this.audioBuffer.clear();
        }

        this.state = State.ENDED;
        return result.samplesDecoded > 0 ? result : null;
    }

    private processBufferedFrames(): DecodedAudio {
        if (this.state !== State.DECODING || !this.format.blockAlign || this.audioBuffer.available < this.format.blockAlign) {
            return this.createEmptyResult();
        }

        const frameSize = this.format.blockAlign;
        const framesToProcess = Math.floor(this.audioBuffer.available / frameSize);
        const bytesToProcess = framesToProcess * frameSize;

        const dataToProcess = this.audioBuffer.read(bytesToProcess);
        if (!dataToProcess) return this.createEmptyResult();

        const decoded = this._processAudioData(dataToProcess);

        this.bytesDecoded += bytesToProcess;
        this.bytesRemaining = Math.max(0, this.bytesRemaining - bytesToProcess);

        return decoded;
    }

    private _processAudioData(data: Uint8Array): DecodedAudio {
        const frameSize = this.format.blockAlign;
        if (frameSize <= 0) return this.createEmptyResult();

        const numFrames = Math.floor(data.length / frameSize);
        const channels = Array.from({length: this.format.channels}, () => new Float32Array(numFrames));
        const view = new DataView(data.buffer, data.byteOffset, data.length);
        const bps = this.format.bitsPerSample / 8;

        for (let ch = 0; ch < this.format.channels; ch++) {
            const channelArray = channels[ch]!;
            for (let i = 0; i < numFrames; i++) {
                const offset = (i * frameSize) + (ch * bps);
                if (offset + bps <= data.length) {
                    channelArray[i] = this.readSample(view, offset, this.format.bitsPerSample, this.effectiveFormat);
                } else {
                    channelArray[i] = 0;
                }
            }
        }

        return {
            channelData: channels,
            samplesDecoded: numFrames,
            sampleRate: this.format.sampleRate,
            errors: [...this.errors.splice(0)],
        };
    }

    private tryParseHeader(): boolean {
        const headerData = this.pendingHeaderData;
        if (headerData.length < 12) { // Minimum size for RIFF/WAVE tags
            return false;
        }

        const tempView = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength);

        const readString = (off: number, len: number) => {
            if (off + len > headerData.length) return '';
            return String.fromCharCode(...headerData.subarray(off, off + len));
        };

        const riff = readString(0, 4);
        if (riff !== 'RIFF' && riff !== 'RIFX') {
            this.state = State.ERROR;
            this.errors.push(this.createError('Invalid WAV file'));
            return false;
        }
        this.isLittleEndian = riff === 'RIFF';

        if (readString(8, 4) !== 'WAVE') {
            this.state = State.ERROR;
            this.errors.push(this.createError('Invalid WAV file'));
            return false;
        }

        const getUint32 = (off: number) => {
            if (off + 4 > headerData.length) return 0;
            return tempView.getUint32(off, this.isLittleEndian);
        };

        let offset = 12;
        let fmtChunk: ChunkInfo | null = null;
        let dataChunk: ChunkInfo | null = null;
        const parsedChunks: ChunkInfo[] = [];

        while (offset + 8 <= headerData.length) {
            const id = readString(offset, 4);
            const size = getUint32(offset + 4);

            if (id === 'data') {
                dataChunk = {id, size, offset};
                parsedChunks.push(dataChunk);
                break;
            }

            const chunkEnd = offset + 8 + size + (size % 2);
            if (chunkEnd > headerData.length) {
                return false;
            }

            const chunkInfo = {id, size, offset};
            parsedChunks.push(chunkInfo);
            if (id === 'fmt ') {
                fmtChunk = chunkInfo;
            }

            offset = chunkEnd;
        }


        if (!fmtChunk || !dataChunk) {
            return false; // Header incomplete, essential chunks not found
        }

        this.parseFormatChunk(fmtChunk, headerData);
        if (!this.validateFormat()) {
            this.state = State.ERROR;
            return false;
        }

        this.parsedChunks = parsedChunks.filter(c => ['fmt ', 'data', 'fact'].includes(c.id));
        this.unhandledChunks = parsedChunks.filter(c => !['fmt ', 'data', 'fact'].includes(c.id));

        const fact = parsedChunks.find(c => c.id === 'fact');
        if (fact && fact.offset + 12 <= headerData.length) {
            this.factSamples = getUint32(fact.offset + 8);
        }

        this.bytesRemaining = this.totalBytes = dataChunk.size;

        const headerEndOffset = dataChunk.offset + 8;
        const leftover = this.pendingHeaderData.subarray(headerEndOffset);
        if (leftover.length > 0) this.audioBuffer.write(leftover);

        this.pendingHeaderData = new Uint8Array(0);
        this.state = State.DECODING;
        return true;
    }

    private parseFormatChunk(chunk: ChunkInfo, headerData: Uint8Array): void {
        const o = chunk.offset + 8;
        const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.length);

        if (o + 16 > headerData.length) {
            this.errors.push(this.createError('Format chunk too small'));
            return;
        }

        this.format = {
            formatTag: view.getUint16(o, this.isLittleEndian),
            channels: view.getUint16(o + 2, this.isLittleEndian),
            sampleRate: view.getUint32(o + 4, this.isLittleEndian),
            bytesPerSecond: view.getUint32(o + 8, this.isLittleEndian),
            blockAlign: view.getUint16(o + 12, this.isLittleEndian),
            bitsPerSample: view.getUint16(o + 14, this.isLittleEndian)
        };
        this.effectiveFormat = this.format.formatTag;

        if (this.format.formatTag === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40 && o + 40 <= headerData.length) {
            this.format.extensionSize = view.getUint16(o + 16, this.isLittleEndian);
            this.format.validBitsPerSample = view.getUint16(o + 18, this.isLittleEndian);
            this.format.channelMask = view.getUint32(o + 20, this.isLittleEndian);
            this.format.subFormat = headerData.subarray(o + 24, o + 40);
            this.effectiveFormat = this.resolveExtensibleFormat();
        }
    }

    private resolveExtensibleFormat(): number {
        const sf = this.format.subFormat;
        if (!sf) return this.format.formatTag;
        if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_PCM)) return WAVE_FORMAT_PCM;
        if (this.arraysEqual(sf, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) return WAVE_FORMAT_IEEE_FLOAT;
        return this.format.formatTag;
    }

    private validateFormat(): boolean {
        if (this.format.bitsPerSample === 0 || this.format.channels === 0 || this.format.sampleRate === 0) {
            this.errors.push(this.createError('Invalid format: zero values in required fields'));
            return false;
        }

        if (this.format.channels > WavStreamDecoder.MAX_CHANNELS) {
            this.errors.push(this.createError(`Too many channels: ${this.format.channels} (max ${WavStreamDecoder.MAX_CHANNELS})`));
            return false;
        }

        if (this.format.sampleRate > WavStreamDecoder.MAX_SAMPLE_RATE) {
            this.errors.push(this.createError(`Sample rate too high: ${this.format.sampleRate} (max ${WavStreamDecoder.MAX_SAMPLE_RATE})`));
            return false;
        }

        const formats = [WAVE_FORMAT_PCM, WAVE_FORMAT_IEEE_FLOAT, WAVE_FORMAT_ALAW, WAVE_FORMAT_MULAW];
        if (!formats.includes(this.effectiveFormat)) {
            this.errors.push(this.createError(`Unsupported audio format: 0x${this.effectiveFormat.toString(16)}`));
            return false;
        }

        const expectedBlockAlign = (this.format.bitsPerSample / 8) * this.format.channels;
        if (this.format.blockAlign !== expectedBlockAlign) {
            this.errors.push(this.createError(
                `Invalid blockAlign: expected ${expectedBlockAlign}, got ${this.format.blockAlign}`
            ));
            return false;
        }

        const valid = this.getValidBitDepths(this.effectiveFormat);
        if (!valid.includes(this.format.bitsPerSample)) {
            this.errors.push(this.createError(`Invalid bit depth: ${this.format.bitsPerSample} for format 0x${this.effectiveFormat.toString(16)}`));
            return false;
        }
        return true;
    }

    private getValidBitDepths(fmt: number): number[] {
        switch (fmt) {
            case WAVE_FORMAT_PCM:
                return [8, 16, 24, 32];
            case WAVE_FORMAT_IEEE_FLOAT:
                return [32, 64];
            case WAVE_FORMAT_ALAW:
            case WAVE_FORMAT_MULAW:
                return [8];
            default:
                return [];
        }
    }

    private readSample(view: DataView, offset: number, bits: number, fmt: number): number {
        try {
            switch (fmt) {
                case WAVE_FORMAT_PCM:
                    return this.readPcm(view, offset, bits);
                case WAVE_FORMAT_IEEE_FLOAT:
                    return this.readFloat(view, offset, bits);
                case WAVE_FORMAT_ALAW:
                    return this.readAlaw(view, offset);
                case WAVE_FORMAT_MULAW:
                    return this.readMulaw(view, offset);
                default:
                    return 0;
            }
        } catch {
            return 0;
        }
    }

    private readPcm(view: DataView, off: number, bits: number): number {
        switch (bits) {
            case 8:
                return (view.getUint8(off) - 128) / 128;
            case 16:
                return view.getInt16(off, this.isLittleEndian) / 32768;
            case 24: {
                const b0 = view.getUint8(off);
                const b1 = view.getUint8(off + 1);
                const b2 = view.getUint8(off + 2);
                let val = 0;
                if (this.isLittleEndian) {
                    val = (b2 << 16) | (b1 << 8) | b0;
                } else {
                    val = (b0 << 16) | (b1 << 8) | b2;
                }
                if (val & 0x800000) {
                    val |= 0xFF000000;
                }
                return val / 8388608;
            }
            case 32:
                return view.getInt32(off, this.isLittleEndian) / 2147483648;
            default:
                return 0;
        }
    }

    private readFloat(view: DataView, off: number, bits: number): number {
        switch (bits) {
            case 32:
                return Math.max(-1, Math.min(1, view.getFloat32(off, this.isLittleEndian)));
            case 64:
                return Math.max(-1, Math.min(1, view.getFloat64(off, this.isLittleEndian)));
            default:
                return 0;
        }
    }

    private readAlaw(view: DataView, off: number): number {
        return WavStreamDecoder.ALAW_TABLE[view.getUint8(off)] || 0;
    }

    private readMulaw(view: DataView, off: number): number {
        return WavStreamDecoder.MULAW_TABLE[view.getUint8(off)] || 0;
    }


    private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    private createEmptyResult(): DecodedAudio {
        return {
            channelData: [],
            samplesDecoded: 0,
            sampleRate: this.format.sampleRate || 0,
            errors: [...this.errors.splice(0)]
        };
    }

    private createErrorResult(msg: string): DecodedAudio {
        this.errors.push(this.createError(msg));
        return {
            channelData: [],
            samplesDecoded: 0,
            sampleRate: this.format.sampleRate || 0,
            errors: [...this.errors]
        };
    }

    private createError(message: string): DecodeError {
        const frameSize = this.format.blockAlign || 0;
        return {
            message: message,
            frameLength: frameSize,
            frameNumber: frameSize > 0 ? Math.floor(this.bytesDecoded / frameSize) : 0,
            inputBytes: this.bytesDecoded,
            outputSamples: frameSize > 0 ? Math.floor(this.bytesDecoded / frameSize) : 0
        };
    }
}
