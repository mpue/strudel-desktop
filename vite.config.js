import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 8000,
    assetsInlineLimit: 0,
  },
  resolve: {
    // Strudel und die App müssen dieselben CodeMirror-Instanzen nutzen, sonst greifen Erweiterungen nicht.
    dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/autocomplete', '@lezer/common', '@lezer/highlight', 'nanostores'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
