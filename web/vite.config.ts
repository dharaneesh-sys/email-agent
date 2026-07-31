import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Server runs on 3030 (Hono). Dev proxy forwards API calls there so the
// SPA works against the live backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
