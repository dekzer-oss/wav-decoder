import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    entry: 'src/index.ts',
  },
  sourcemap: true,
  clean: true,
  tsconfig: 'tsconfig.build.json',
  minify: true,
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js',
    };
  },
  terserOptions: {
    compress: {
      drop_console: true,
    },
    format: {
      comments: false,
    },
  },
});
