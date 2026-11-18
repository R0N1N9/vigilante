import { describe, expect, it } from 'vitest';
import hosts from '../config/hosts.json' with { type: 'json' };
import { RateLimiter, cacheSeconds, corsOrigin, isAllowedTarget, parseOrigins, redirectTarget, responseHeaders, targetOf } from '../web/proxy/policy';
import { handle } from '../web/proxy/worker';
import { proxyUrl } from '../src/lib/http';

const ALLOWED = new Set(hosts.get);
const P = 'https://proxy.example.dev/?url=';
const req = (target: string, init: RequestInit & { ip?: string } = {}) =>
  new Request(P + encodeURIComponent(target), { ...init, headers: { 'cf-connecting-ip': init.ip ?? '203.0.113.9', ...(init.headers as Record<string, string>) } });

describe('proxy allowlist', () => {
  it('allows exact allow-listed HTTPS hosts only', () => {
    expect(isAllowedTarget(new URL('https://api.weather.gov/alerts/active?area=CO'), ALLOWED)).toBe(true);
    expect(isAllowedTarget(new URL('https://API.Weather.gov/x'), ALLOWED)).toBe(true); // hostnames are case-insensitive
    expect(isAllowedTarget(new URL('http://api.weather.gov/'), ALLOWED)).toBe(false);
    expect(isAllowedTarget(new URL('https://evil.example/'), ALLOWED)).toBe(false);
    expect(isAllowedTarget(new URL('https://api.weather.gov.evil.example/'), ALLOWED)).toBe(false);
    expect(isAllowedTarget(new URL('https://x.api.weather.gov/'), ALLOWED)).toBe(false); // no subdomain wildcards
    expect(isAllowedTarget(new URL('https://user:pw@api.weather.gov/'), ALLOWED)).toBe(false);
    expect(isAllowedTarget(new URL('https://api.weather.gov:8443/'), ALLOWED)).toBe(false);
    expect(isAllowedTarget(new URL('https://127.0.0.1/'), ALLOWED)).toBe(false);
  });

  it('reads the target from ?url= and rejects junk', () => {
    expect(targetOf(`${P}${encodeURIComponent('https://earthquake.usgs.gov/q#frag')}`, ALLOWED)?.href).toBe('https://earthquake.usgs.gov/q');
    expect(targetOf('https://proxy.example.dev/', ALLOWED)).toBeNull();
    expect(targetOf(`${P}not%20a%20url`, ALLOWED)).toBeNull();
    expect(targetOf(`${P}${encodeURIComponent('file:///etc/passwd')}`, ALLOWED)).toBeNull();
    expect(targetOf(`${P}${encodeURIComponent('https://metadata.google.internal/')}`, ALLOWED)).toBeNull();
  });

  it('follows redirects only to allow-listed hosts', () => {
    const from = new URL('https://services1.arcgis.com/a/b');
    expect(redirectTarget('/c?d=1', from, ALLOWED)?.href).toBe('https://services1.arcgis.com/c?d=1');
    expect(redirectTarget('https://services3.arcgis.com/x', from, ALLOWED)?.hostname).toBe('services3.arcgis.com');
    expect(redirectTarget('https://cdn.evil.example/x', from, ALLOWED)).toBeNull();
    expect(redirectTarget('http://services3.arcgis.com/x', from, ALLOWED)).toBeNull();
    expect(redirectTarget(null, from, ALLOWED)).toBeNull();
  });

  it('handles origins and caching', () => {
    expect(parseOrigins(' https://a.dev/, https://b.dev ,')).toEqual(['https://a.dev', 'https://b.dev']);
    expect(corsOrigin('https://x.dev', [])).toBe('*');
    expect(corsOrigin('https://a.dev', ['https://a.dev'])).toBe('https://a.dev');
    expect(corsOrigin('https://x.dev', ['https://a.dev'])).toBeNull();
    expect(corsOrigin(null, ['https://a.dev'])).toBeNull();
    expect(cacheSeconds(200)).toBe(30);
    expect(cacheSeconds(500)).toBe(0);
    const h = responseHeaders(new Headers({ 'content-type': 'application/json', 'set-cookie': 'a=b', 'access-control-allow-credentials': 'true' }), 200, '*');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('set-cookie')).toBeNull();
    expect(h.get('access-control-allow-credentials')).toBeNull();
    expect(h.get('cache-control')).toContain('max-age=30');
  });

  it('rate-limits per key in a fixed window', () => {
    const rl = new RateLimiter(3, 60_000, 4);
    const t = 1_000_000;
    expect([1, 2, 3, 4].map(() => rl.hit('a', t).ok)).toEqual([true, true, true, false]);
    expect(rl.hit('b', t).ok).toBe(true);
    expect(rl.hit('a', t + 60_000).ok).toBe(true); // new window
    for (let i = 0; i < 20; i++) rl.hit(`k${i}`, t + 61_000); // bounded memory
    expect(rl.hit('a', t + 61_000).remaining).toBeGreaterThanOrEqual(0);
  });

  it('builds the client-side proxy URL', () => {
    expect(proxyUrl('https://api.weather.gov/a?b=1&c=2', 'https://p.dev/')).toBe('https://p.dev?url=https%3A%2F%2Fapi.weather.gov%2Fa%3Fb%3D1%26c%3D2');
  });
});

describe('proxy worker', () => {
  const ok = (body = '{}', headers: Record<string, string> = { 'content-type': 'application/json' }) => new Response(body, { status: 200, headers });

  it('fetches allow-listed URLs without forwarding visitor headers', async () => {
    let seen: Headers | null = null;
    const res = await handle(req('https://api.weather.gov/alerts', { headers: { cookie: 'session=1', authorization: 'Bearer x', origin: 'https://app.dev' } }), {}, async (_u, init) => {
      seen = new Headers(init?.headers);
      return ok('{"ok":1}', { 'content-type': 'application/geo+json', 'set-cookie': 'x=1' });
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":1}');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(seen!.get('cookie')).toBeNull();
    expect(seen!.get('authorization')).toBeNull();
    expect(seen!.get('user-agent')).toMatch(/^Vigilance\//);
  });

  it('refuses other hosts, other methods and other origins', async () => {
    const never = async () => {
      throw new Error('should not fetch');
    };
    expect((await handle(req('https://evil.example/'), {}, never)).status).toBe(403);
    expect((await handle(req('https://api.weather.gov/', { method: 'POST', body: 'x' }), {}, never)).status).toBe(405);
    expect((await handle(req('https://api.weather.gov/', { method: 'PUT', body: 'x' }), {}, never)).status).toBe(405);
    expect((await handle(req('https://api.weather.gov/', { headers: { origin: 'https://other.dev' } }), { ALLOWED_ORIGINS: 'https://app.dev' }, never)).status).toBe(403);
    const pre = await handle(req('https://api.weather.gov/', { method: 'OPTIONS' }), {}, never);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET');
  });

  it('follows allow-listed redirects and stops at others', async () => {
    const chain: Record<string, Response> = {
      'https://services1.arcgis.com/a': new Response(null, { status: 302, headers: { location: 'https://services3.arcgis.com/b' } }),
      'https://services3.arcgis.com/b': ok('done'),
      'https://earthquake.usgs.gov/x': new Response(null, { status: 301, headers: { location: 'https://evil.example/' } }),
    };
    const f = async (u: RequestInfo | URL) => chain[String(u)] ?? new Response('missing', { status: 404 });
    expect(await (await handle(req('https://services1.arcgis.com/a'), {}, f)).text()).toBe('done');
    expect((await handle(req('https://earthquake.usgs.gov/x'), {}, f)).status).toBe(502);
  });

  it('returns 429 past the per-IP limit', async () => {
    const env = { RATE_LIMIT_PER_MIN: '2' };
    const f = async () => ok();
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await handle(req('https://api.weather.gov/', { ip: '198.51.100.7' }), env, f)).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect((await handle(req('https://api.weather.gov/', { ip: '198.51.100.8' }), env, f)).status).toBe(200);
  });
});
