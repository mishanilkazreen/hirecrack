import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works when served from the Electron local server or any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 4000 },
});
