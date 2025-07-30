import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    globals: true,

    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        extends: './vite.config.ts',
        test: {
          name: 'browser-chrome',
          environment: 'happy-dom',
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
      {
        extends: './vite.config.ts',
        test: {
          name: 'browser-firefox',
          environment: 'happy-dom',
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
      {
        extends: './vite.config.ts',
        test: {
          name: 'browser-safari',
          environment: 'happy-dom',
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
