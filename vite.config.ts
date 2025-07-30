import { defineConfig } from 'vite';
import { resolve } from 'node:url';

export default defineConfig({
  base: '/wav-decoder/',
  root: './',
  build: {
    outDir: './dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sandbox: resolve(__dirname, 'stream-and-play.html'),
        analyzer: resolve(__dirname, 'starter.html'),
      },
    },
  },
});
