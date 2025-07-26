import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.test.ts'],
        },
      },
      // {
      //   test: {
      //     name: 'browser',
      //     environment: 'browser',
      //     globals: true,
      //     include: ['tests/**/*.test.ts'],
      //     benchmark: {},
      //     browser: {
      //       enabled: true,
      //       provider: 'playwright',
      //       headless: true,
      //       screenshotFailures: false,
      //       instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
      //     },
      //   },
      // },
      // Separate Chrome project for benchmarks
      {
        test: {
          name: 'browser-chrome',
          environment: 'browser',
          globals: true,
          include: ['tests/**/*.test.ts'],
          benchmark: {},
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      // Separate Firefox project for benchmarks
      {
        test: {
          name: 'browser-firefox',
          environment: 'browser',
          globals: true,
          include: ['tests/**/*.test.ts'],
          benchmark: {},
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'firefox' }],
          },
        },
      },
      // Separate Safari/WebKit project for benchmarks
      {
        test: {
          name: 'browser-safari',
          environment: 'browser',
          globals: true,
          include: ['tests/**/*.test.ts'],
          benchmark: {},
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
