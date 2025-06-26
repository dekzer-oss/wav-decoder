export interface DecodeError {
  message: string;
  frameLength: number;
  frameNumber: number;
  inputBytes: number;
  outputSamples: number;
}

export interface DecodedAudio {
  channelData: Float32Array[];
  samplesDecoded: number;
  sampleRate: number;
  errors: DecodeError[];
}

export interface WavFormat {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bytesPerSecond: number;
  blockAlign: number;
  bitsPerSample: number;
  extensionSize?: number;
  validBitsPerSample?: number;
  channelMask?: number;
  subFormat?: Uint8Array;
}
