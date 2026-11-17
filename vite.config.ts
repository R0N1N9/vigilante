import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EnvHttpProxyAgent, fetch as ufetch } from 'undici';
import { defineConfig, type Plugin } from 'vite';
import { DATA_HOSTS } from './src/lib/hosts.ts';

/**
 * Browser dev mode only: a tiny server-side fetch at /proxy?url=... so the UI can
 * reach data APIs without CORS issues. The desktop app uses the Rust core instead.
 */
function devProxy(): Plugin {
  const dispatcher = new EnvHttpProxyAgent();
  const allowed = new Set<string>(DATA_HOSTS);
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const target = new URL(new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '');
      if (target.protocol !== 'https:' || !allowed.has(target.hostname)) {
        res.statusCode = 403;
        res.end('host not allowed');
        return;
      }
      const r = await ufetch(target, {
        dispatcher,
        headers: { 'User-Agent': 'Vigilante/0.1 (dev)', Accept: 'application/geo+json, application/json' },
      });
      res.statusCode = r.status;
      res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/json');
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.statusCode = 502;
      res.end(String(e));
    }
  };
  return {
    name: 'vigilante-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/proxy', (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/proxy', (req, res) => void handler(req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
