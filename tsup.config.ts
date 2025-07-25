import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  splitting: false,
  dts: true,
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
