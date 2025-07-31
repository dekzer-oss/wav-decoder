import { expect } from 'vitest';
import * as utils from './vitest-utils';

declare module 'vitest' {
  interface Assertion<T = any> {
    toPartiallyMatch(obj: Partial<T>): void;
  }
}

expect.extend({
  toPartiallyMatch(received, expected) {
    const pass = Object.entries(expected).every(([k, v]) => {
      return received[k] === v;
    });

    return {
      pass,
      message: () => `expected object to ${pass ? 'not ' : ''}match partial: ${JSON.stringify(expected)}`,
    };
  },
});

Object.assign(globalThis, utils);
