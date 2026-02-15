import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: {
    port: 5173,
    proxy: {
      // Proxy API + webhook calls to the backend in dev
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist-client',
    emptyOutDir: true,
  },
});
