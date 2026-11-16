import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production the web app and /api share one Vercel domain. For local development, point
// CAMPFIRE_API_URL at a deployed API (for example a preview deployment) to proxy /api there.
const apiTarget = process.env.CAMPFIRE_API_URL;

export default defineConfig({
  plugins: [react()],
  server: apiTarget ? { proxy: { '/api': { target: apiTarget, changeOrigin: true } } } : undefined,
});
