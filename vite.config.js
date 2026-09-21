import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', allowedHosts: true },
  worker: { format: 'es' },
});
