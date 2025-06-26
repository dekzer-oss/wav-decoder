import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',

  // --- Optimizations ---

  // Minify the output to reduce bundle size.
  minify: true,

  // Options for the Terser minifier.
  terserOptions: {
    compress: {
      // Remove console.log statements from the production build.
      drop_console: true,
    },
    format: {
      // Remove all comments from the output.
      comments: false,
    },
  },
});
