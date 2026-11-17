import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devProxy } from './scripts/dev-proxy.ts';

export default defineConfig({
  plugins: [react(), devProxy()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
