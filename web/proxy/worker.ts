/**
 * Vigilance web CORS proxy (Cloudflare Worker).
 *
 *   GET https://<worker>/?url=<https URL on an allow-listed host>
 *
 * The desktop app reaches data sources through its Rust core; the hosted web
 * app has no core, so it uses this Worker. Same rules as the core: only hosts in
 * config/hosts.json, GET only, redirects only to allow-listed hosts, no client
 * headers, cookies or credentials forwarded, honest User-Agent. It doesn't log
 * request URLs. Deploy: see web/proxy/README.md.
 */
import hosts from '../../config/hosts.json' with { type: 'json' };
import { MAX_REDIRECTS, RateLimiter, cacheSeconds, corsOrigin, parseOrigins, redirectTarget, responseHeaders, targetOf } from './policy';

export interface Env {
  /** Comma-separated origins allowed to use the proxy, e.g. "https://r0n1n9.github.io". Empty = any. */
  ALLOWED_ORIGINS?: string;
  /** Requests per minute per IP for the in-memory limiter (default 300). */
  RATE_LIMIT_PER_MIN?: string;
  /** Optional Cloudflare rate-limit binding (global across isolates). */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const ALLOWED = new Set<string>(hosts.get.map((h) => h.toLowerCase()));
const USER_AGENT = 'Vigilance/0.1 (web proxy; neighborhood awareness console; github.com/r0n1n9/vigilance)';
const ACCEPT = 'application/geo+json, application/json, application/rss+xml, application/xml, text/xml, */*';
const MAX_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

let limiter: RateLimiter | null = null;

function plain(status: number, text: string, allowOrigin: string | null, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
  if (allowOrigin) h['Access-Control-Allow-Origin'] = allowOrigin;
  return new Response(text, { status, headers: h });
}

async function allowedByRate(req: Request, env: Env): Promise<{ ok: boolean; retryAfterS: number }> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.RATE_LIMITER) {
    const r = await env.RATE_LIMITER.limit({ key: ip });
    return { ok: r.success, retryAfterS: 60 };
  }
  const limit = Number(env.RATE_LIMIT_PER_MIN) > 0 ? Number(env.RATE_LIMIT_PER_MIN) : 300;
  if (!limiter || limiter.limit !== limit) limiter = new RateLimiter(limit);
  return limiter.hit(ip);
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const allowOrigin = corsOrigin(req.headers.get('origin'), parseOrigins(env.ALLOWED_ORIGINS));
  if (req.method === 'OPTIONS') {
    // The app only sends simple GETs, so no request headers are ever allowed.
    return new Response(null, { status: 204, headers: { ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
  }
  if (req.method !== 'GET') return plain(405, 'GET only', allowOrigin, { Allow: 'GET' });
  if (!allowOrigin) return plain(403, 'origin not allowed', null);

  const rate = await allowedByRate(req, env);
  if (!rate.ok) return plain(429, 'too many requests', allowOrigin, { 'Retry-After': String(rate.retryAfterS) });

  const first = targetOf(req.url, ALLOWED);
  if (!first) return plain(403, 'host not allowed', allowOrigin);
  let target: URL = first;

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // A fresh header set: nothing from the visitor's request (cookies, auth, referrer, IP headers) is forwarded.
  const init = (): RequestInit & { cf?: unknown } => ({
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
    cf: { cacheTtlByStatus: { '200-299': cacheSeconds(200), '404': cacheSeconds(404), '300-599': 0 }, cacheEverything: true },
  });
  let res: Response;
  try {
    res = await fetcher(target.toString(), init());
    for (let hop = 0; res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
      const next: URL | null = hop < MAX_REDIRECTS ? redirectTarget(res.headers.get('location'), target, ALLOWED) : null;
      if (!next) return plain(502, 'redirect to a host that is not allowed', allowOrigin);
      target = next;
      res = await fetcher(target.toString(), init());
    }
  } catch (e) {
    return plain(502, `upstream request failed: ${e instanceof Error ? e.name : 'error'}`, allowOrigin);
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) return plain(502, 'upstream response too large', allowOrigin);
  return new Response(res.body, { status: res.status, headers: responseHeaders(res.headers, res.status, allowOrigin) });
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
};
