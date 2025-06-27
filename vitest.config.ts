import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.bench.ts'],
    browser: {
      provider: 'playwright',
      enabled: true,
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: 'chromium',
        },
        {
          browser: 'firefox',
        },
        {
          browser: 'webkit',
        },
      ],
    },
  },
});
