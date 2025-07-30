import { defineConfig } from 'vite';
import path from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/wasm': path.resolve(__dirname, 'src/wasm'),
    },
  },
  plugins: [tsconfigPaths()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
