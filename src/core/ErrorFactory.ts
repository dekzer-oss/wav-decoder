import type { DecodeError } from '../types';
import type { StateManager } from './StateManager';

/**
 * Creates standardized DecodeError objects using context from the state manager.
 */
export class ErrorFactory {
  private readonly stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  public create(message: string): DecodeError {
    const { format, decodedBytes, estimatedSamples } = this.stateManager;
    const frameLength = format.blockAlign;
    return {
      message,
      inputBytes: decodedBytes,
      frameLength: frameLength,
      frameNumber: frameLength > 0 ? Math.floor(decodedBytes / frameLength) : 0,
      outputSamples: estimatedSamples,
    };
  }
}
