import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib';

  return {
    base: isLib ? undefined : '/wav-decoder/',
    test: {
      hookTimeout: 120_000,
      testTimeout: 60_000,
      globals: true,
      setupFiles: ['./tests/fixtures/vitest.setup.ts'],
    },
    plugins: isLib
      ? [
          dts({
            outDir: 'dist',
            entryRoot: 'src',
            exclude: ['src/RingBuffer.ts'],
          }),
        ]
      : [],
    build: isLib
      ? {
          lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            fileName: 'index',
            formats: ['es'],
            name: 'WavDecoder',
          },
          target: 'node20',
          outDir: 'dist',
          emptyOutDir: true,
          minify: true,
          sourcemap: false,
          rollupOptions: {
            output: {
              entryFileNames: '[name].js',
            },
          },
        }
      : {
          minify: true,
          outDir: 'dist',
          emptyOutDir: true,
          rollupOptions: {
            input: {
              main: resolve(__dirname, 'index.html'),
              starter: resolve(__dirname, 'starter.html'),
              streamAndPlay: resolve(__dirname, 'stream-and-play.html'),
            },
          },
        },
  };
});
