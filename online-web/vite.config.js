import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built app is served by the OnlineLotto server at "/" (see ../src/app.js), so API calls are
// same-origin. In dev, /api and the /ws live socket are proxied to that server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }, // live term updates
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
