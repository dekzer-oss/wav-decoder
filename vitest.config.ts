import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.bench.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'happy-dom',
          globals: true,
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.bench.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
