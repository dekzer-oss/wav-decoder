import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  splitting: false,
  dts: true,
  target: 'node20',
  sourcemap: false,
  clean: true,
  minify: true,
  esbuildOptions(options) {
    options.minifyWhitespace = true;
    options.pure ||= [];
    options.pure.push('console.log', 'console.debug');
  },
  outExtension: () => ({
    js: '.js',
  }),
});
