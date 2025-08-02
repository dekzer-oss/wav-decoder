/**
 * Represents various states of a decoding process.
 *
 * The `DecoderState` enum is used to track and manage the current state
 * of a decoding operation. It helps ensure proper handling and transitions
 * during the decoding lifecycle.
 *
 * Enumerated Values:
 * - DECODING: Indicates that decoding is currently in progress.
 * - ENDED: Indicates that decoding has successfully completed.
 * - ERROR: Indicates that an error occurred during decoding.
 * - IDLE: Represents an uninitialized or default state, typically
 *   before decoding has started.
 */
export enum DecoderState {
  DECODING,
  ENDED,
  ERROR,
  IDLE,
}

export class DecoderStateMachine {
  private _state: DecoderState = DecoderState.IDLE;
  private _errors: string[] = [];

  public get state(): DecoderState {
    return this._state;
  }

  public transition(newState: DecoderState): void {
    if (this.isValidTransition(newState)) {
      this._state = newState;
    } else {
      this._errors.push(`Invalid state transition: ${this._state} -> ${newState}`);
    }
  }

  private isValidTransition(newState: DecoderState): boolean {
    switch (this._state) {
      case DecoderState.IDLE:
        return newState === DecoderState.DECODING;
      case DecoderState.DECODING:
        return newState === DecoderState.ENDED || newState === DecoderState.ERROR;
      case DecoderState.ENDED:
      case DecoderState.ERROR:
        return false;
      default:
        return false;
    }
  }

  public get errors(): string[] {
    return this._errors;
  }

  public reset(): void {
    this._state = DecoderState.IDLE;
    this._errors = [];
  }
}
