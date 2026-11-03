import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/dist-overlay/**'] },
  },
  build: {
    outDir: 'dist-overlay',
    target: 'es2022',
    rollupOptions: { input: { overlay: resolve(__dirname, 'overlay.html'), spotlight: resolve(__dirname, 'spotlight.html'), settings: resolve(__dirname, 'settings.html') } },
  },
});
