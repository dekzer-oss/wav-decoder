import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  target: 'node18',
  sourcemap: false,
  clean: true,
  minify: true,
  outExtension: ({ format }) => ({
    js: format === 'esm' ? '.mjs' : '.cjs',
  }),
  esbuildOptions(options) {
    // strip console/debugger in one pass
    options.minifyWhitespace = true;
    options.pure ||= [];
    options.pure.push('console.log', 'console.debug');
  },
});
