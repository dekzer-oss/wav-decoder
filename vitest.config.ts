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
          exclude: ['tests/**/*.bench.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'happy-dom',
          globals: true,
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.bench.ts'],
          browser: {
            provider: 'playwright',
            enabled: true,
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
