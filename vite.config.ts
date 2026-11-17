import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EnvHttpProxyAgent, fetch as ufetch } from 'undici';
import { defineConfig, type Plugin } from 'vite';
import hosts from './config/hosts.json' with { type: 'json' };

/**
 * Browser dev mode only: a tiny server-side fetch at /proxy?url=... so the UI can
 * reach data APIs without CORS issues. The desktop app uses the Rust core instead.
 */
function devProxy(): Plugin {
  const dispatcher = new EnvHttpProxyAgent();
  const allowed = new Set<string>(hosts.get);
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const target = new URL(new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '');
      if (target.protocol !== 'https:' || !allowed.has(target.hostname)) {
        res.statusCode = 403;
        res.end('host not allowed');
        return;
      }
      let r = await ufetch(target, {
        dispatcher,
        redirect: 'manual',
        headers: { 'User-Agent': 'Vigilante/0.1 (dev)', Accept: 'application/geo+json, application/json, application/rss+xml, application/xml, */*' },
      });
      for (let hop = 0; hop < 5 && r.status >= 300 && r.status < 400 && r.headers.get('location'); hop++) {
        const next = new URL(r.headers.get('location')!, target);
        if (next.protocol !== 'https:' || !allowed.has(next.hostname)) break;
        r = await ufetch(next, { dispatcher, redirect: 'manual', headers: { 'User-Agent': 'Vigilante/0.1 (dev)' } });
      }
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
