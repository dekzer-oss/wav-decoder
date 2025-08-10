import { defineConfig } from 'vite';
import terser from '@rollup/plugin-terser';
import dts from 'vite-plugin-dts';

export default defineConfig({
  publicDir: false,
  build: {
    copyPublicDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      treeshake: 'smallest',
      plugins: [
        terser({
          format: {
            comments: false,
            semicolons: false,
            indent_level: 0,
            preserve_annotations: true,
          },
          mangle: {
            toplevel: true,
          },
        }),
      ],
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'index.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  esbuild: {
    legalComments: 'none',
  },
  plugins: [
    dts({
      rollupTypes: true,
      bundledPackages: ['*'],
      include: ['src/**/*'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
    }),
  ],
});
