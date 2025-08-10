import { defineConfig } from 'vite';

export default defineConfig({
  base: '/wav-decoder/',
  build: {
    outDir: 'pages',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        starter: 'starter.html',
        'stream-and-play': 'stream-and-play.html',
      },
    },
  },
});
