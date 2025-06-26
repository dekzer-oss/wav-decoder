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
