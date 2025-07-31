// vitest-utils.ts
import { expect, vi, it, type DeeplyAllowMatchers } from 'vitest';

/**
 * Asserts that a warning array contains a warning matching a regex.
 * @param warnings Array of warning strings
 * @param pattern Regex or string to match against
 */
export function expectWarning(warnings: string[], pattern: RegExp | string) {
  expect(warnings).toEqual(
    expect.arrayContaining([
      typeof pattern === 'string' ? expect.stringContaining(pattern) : expect.stringMatching(pattern),
    ])
  );
}

/**
 * Sugar for asserting a partial object match
 */
export function expectPartialObject<T>(received: T, partial: Partial<T>) {
  expect(received).toEqual(expect.objectContaining(partial as DeeplyAllowMatchers<T>));
}

/**
 * Wrap test in fake timers with automatic restore
 */
export function withFakeTime(cb: () => void | Promise<void>) {
  return async () => {
    vi.useFakeTimers();
    try {
      await cb();
    } finally {
      vi.useRealTimers();
    }
  };
}

/**
 * Runs a test case with multiple inputs
 */
export function testEach<T>(name: string, cases: T[], runner: (value: T) => void) {
  for (const c of cases) {
    it(`${name} [${JSON.stringify(c)}]`, () => runner(c));
  }
}

/**
 * Expect that a function throws a specific error string or pattern
 */
export function expectThrows(fn: () => unknown, msg: string | RegExp) {
  if (typeof msg === 'string') {
    expect(fn).toThrowError(new Error(msg));
  } else {
    expect(fn).toThrowError(msg);
  }
}

/**
 * Expects at least one assertion to run — avoids false pass in async tests
 */
export function mustAssert() {
  expect.hasAssertions();
}
