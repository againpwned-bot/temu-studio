import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
