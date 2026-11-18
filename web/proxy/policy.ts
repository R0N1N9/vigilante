/**
 * Request policy for the web CORS proxy (web/proxy/worker.ts) and the dev proxy.
 * Mirrors the Rust core (src-tauri/src/lib.rs): HTTPS only, exact host match
 * against config/hosts.json, GET only, no client headers or cookies forwarded,
 * redirects followed only to allow-listed hosts.
 */

export type HostList = ReadonlySet<string> | readonly string[];

const has = (list: HostList, host: string) => ('has' in list ? list.has(host) : list.includes(host));

/** HTTPS, default port, no embedded credentials, and an exact (case-insensitive) host match. */
export function isAllowedTarget(url: URL, allowed: HostList): boolean {
  return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && has(allowed, url.hostname.toLowerCase());
}

/** The target URL from a proxy request (`?url=...`), or null if it is missing, malformed or not allowed. */
export function targetOf(requestUrl: string, allowed: HostList): URL | null {
  let raw: string | null;
  try {
    raw = new URL(requestUrl).searchParams.get('url');
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const t = new URL(raw);
    t.hash = '';
    return isAllowedTarget(t, allowed) ? t : null;
  } catch {
    return null;
  }
}

/** Where a redirect points, if it may be followed (relative Locations resolve against the current URL). */
export function redirectTarget(location: string | null, from: URL, allowed: HostList): URL | null {
  if (!location) return null;
  try {
    const next = new URL(location, from);
    return isAllowedTarget(next, allowed) ? next : null;
  } catch {
    return null;
  }
}

export const MAX_REDIRECTS = 5;

/** Origins allowed to call the proxy. Empty list = any origin (the host allowlist still applies). */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Access-Control-Allow-Origin value for a request, or null to refuse it. Never allows credentials. */
export function corsOrigin(origin: string | null, allowed: string[]): string | null {
  if (!allowed.length) return '*';
  if (!origin) return null;
  return allowed.includes(origin) ? origin : null;
}

/**
 * Fixed-window per-key counter (per Worker isolate, so it's a soft limit;
 * bind Cloudflare's rate-limit API as RATE_LIMITER for a global one).
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
  ) {}

  /** Count one request. Returns whether it is allowed and how long until the window resets. */
  hit(key: string, now = Date.now()): { ok: boolean; remaining: number; retryAfterS: number } {
    let e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      if (!e && this.hits.size >= this.maxKeys) this.prune(now);
      e = { start: now, n: 0 };
      this.hits.set(key, e);
    }
    e.n++;
    const retryAfterS = Math.max(1, Math.ceil((e.start + this.windowMs - now) / 1000));
    return { ok: e.n <= this.limit, remaining: Math.max(0, this.limit - e.n), retryAfterS };
  }

  private prune(now: number) {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
    // Still full (a burst of distinct keys): drop the oldest entries rather than grow without bound.
    while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
  }
}

/** Short cache lifetimes: data is live, but many visitors in one city share the same upstream URLs. */
export function cacheSeconds(status: number): number {
  if (status >= 200 && status < 300) return 30;
  if (status === 404) return 10;
  return 0;
}

/** Only the content type is passed back from upstream; cookies and everything else are dropped. */
export function responseHeaders(upstream: Headers, status: number, allowOrigin: string): Headers {
  const h = new Headers();
  h.set('Content-Type', upstream.get('content-type') ?? 'application/octet-stream');
  const ttl = cacheSeconds(status);
  h.set('Cache-Control', ttl ? `public, max-age=${ttl}, s-maxage=${ttl}` : 'no-store');
  h.set('Access-Control-Allow-Origin', allowOrigin);
  if (allowOrigin !== '*') h.set('Vary', 'Origin');
  // Proxied pages must never run as this origin, or be framed.
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  h.set('Referrer-Policy', 'no-referrer');
  return h;
}
