/**
 * Web build of Vigilance (same src/, no Rust core).
 *   npm run dev:web      dev server with the local /proxy
 *   npm run build:web    -> dist-web/ (index.html, embed.html, embed.js, _headers)
 *   npm run preview:web  serve dist-web/ with the production headers
 * Env: VITE_PROXY_URL (the deployed web/proxy Worker), VITE_BASE (e.g. /vigilance/ on GitHub Pages).
 */
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { devProxy } from '../scripts/dev-proxy.ts';
import { cspMeta, headersFile, securityHeaders } from './headers.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

/** Build only: CSP <meta> in each page, plus the _headers file for hosts that read it. */
function webHeaders(): Plugin {
  return {
    name: 'vigilante-web-headers',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: cspMeta() }, injectTo: 'head-prepend' }],
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() });
    },
  };
}

/**
 * Phone install (manifest + icons) shared with the desktop page: copied from the repo's public/
 * with fixed names, so the manifest's relative start_url/scope and icon paths work under any base.
 */
const PWA_FILES = ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
const PWA_TYPES: Record<string, string> = { webmanifest: 'application/manifest+json', png: 'image/png' };

function pwaFiles(): Plugin {
  const read = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url));
  return {
    name: 'vigilante-web-pwa',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const f = PWA_FILES.find((n) => (req.url ?? '').split('?')[0].endsWith(`/${n}`));
        if (!f) return next();
        res.setHeader('Content-Type', PWA_TYPES[f.split('.').pop()!]);
        res.end(read(f));
      });
    },
    generateBundle() {
      for (const f of PWA_FILES) this.emitFile({ type: 'asset', fileName: f, source: read(f) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repo, 'VITE_'), ...process.env };
  const base = env.VITE_BASE || '/';
  return {
    root,
    base: base.endsWith('/') ? base : `${base}/`,
    envDir: repo,
    envPrefix: ['VITE_'],
    publicDir: 'public',
    define: { 'import.meta.env.VITE_WEB': JSON.stringify('1') },
    plugins: [react(), devProxy(), webHeaders(), pwaFiles()],
    clearScreen: false,
    server: { port: 5180, strictPort: true, fs: { allow: [repo] } },
    preview: { port: 4180, strictPort: true, headers: securityHeaders() },
    build: {
      outDir: fileURLToPath(new URL('../dist-web', import.meta.url)),
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 2000,
      rollupOptions: { input: { index: `${root}index.html`, embed: `${root}embed.html` } },
    },
  };
});
