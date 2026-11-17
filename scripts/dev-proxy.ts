import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import hosts from '../config/hosts.json' with { type: 'json' };
import { isAllowedTarget } from '../web/proxy/policy.ts';

/**
 * Browser dev mode only (desktop `npm run dev` and `npm run dev:web`): a tiny server-side fetch at /proxy?url=... so the UI can
 * reach data APIs without CORS issues. The desktop app uses the Rust core instead.
 */
export function devProxy(): Plugin {
  // Plain fetch normally. Only behind an HTTP(S) proxy (e.g. a corporate network) load undici's proxy agent.
  const proxied = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
  let fetcher: Promise<(url: URL, init: Record<string, unknown>) => Promise<Response>> | null = null;
  const getFetch = () =>
    (fetcher ??= proxied
      ? import('undici').then(({ EnvHttpProxyAgent, fetch }) => {
          const dispatcher = new EnvHttpProxyAgent();
          return (url: URL, init: Record<string, unknown>) => fetch(url, { ...init, dispatcher } as never) as unknown as Promise<Response>;
        })
      : Promise.resolve((url: URL, init: Record<string, unknown>) => fetch(url, init as RequestInit)));
  const allowed = new Set<string>(hosts.get);
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const target = new URL(new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '');
      if (!isAllowedTarget(target, allowed)) {
        res.statusCode = 403;
        res.end('host not allowed');
        return;
      }
      const ufetch = await getFetch();
      let r = await ufetch(target, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Vigilante/0.1 (dev)',
          Accept: 'application/geo+json, application/json, application/rss+xml, application/xml, */*',
        },
      });
      for (let hop = 0; hop < 5 && r.status >= 300 && r.status < 400 && r.headers.get('location'); hop++) {
        const next = new URL(r.headers.get('location')!, target);
        if (!isAllowedTarget(next, allowed)) break;
        r = await ufetch(next, { redirect: 'manual', headers: { 'User-Agent': 'Vigilante/0.1 (dev)' } });
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

