/**
 * Web build of Vigilance (same src/, no Rust core).
 *   npm run dev:web      dev server with the local /proxy
 *   npm run build:web    -> dist-web/ (index.html, embed.html, embed.js, _headers)
 *   npm run preview:web  serve dist-web/ with the production headers
 * Env: VITE_PROXY_URL (the deployed web/proxy Worker), VITE_BASE (e.g. /vigilante/ on GitHub Pages).
 */
import react from '@vitejs/plugin-react';
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
    plugins: [react(), devProxy(), webHeaders()],
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
