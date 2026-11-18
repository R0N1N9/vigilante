# Vigilance web proxy (Cloudflare Worker)

The desktop app fetches data through its Rust core. Most of those sources don't send CORS
headers, so the hosted web app needs a small proxy instead. This Worker is that proxy, with
the same rules as the Rust core:

- **Only hosts in [`config/hosts.json`](../../config/hosts.json)**, HTTPS on the default port, exact host match (no wildcards, no IPs, no credentials in the URL).
- **GET only.** `OPTIONS` answers CORS preflights; everything else gets 405.
- **Redirects** are followed (up to 5) only to allow-listed hosts; anything else is a 502.
- **Nothing from the visitor is forwarded**: no cookies, `Authorization`, referrer or IP headers. Upstream `Set-Cookie` is dropped. CORS never allows credentials.
- **Honest User-Agent** (`Vigilance/0.1 (web proxy; ...)`). No header spoofing, no logins, nothing behind access controls.
- **Short caching**: 30 s for successes, 10 s for 404s, nothing for errors (at the edge and in the browser).
- **Per-IP rate limit** (default 300 requests/minute per Worker isolate), or a global one if you bind Cloudflare's rate-limiting API.
- Proxied responses carry `Content-Security-Policy: default-src 'none'; sandbox`, so a proxied page can never run as the Worker's origin.
- The Worker doesn't log request URLs. Note that the optional Georgia 511 and COtrip keys are part of those URLs, so they pass through the Worker if a visitor adds them.

## Deploy

You need a free Cloudflare account. From the repository root:

```bash
npm ci
cd web/proxy
npx wrangler login
npx wrangler deploy
```

Wrangler prints the URL, e.g. `https://vigilante-proxy.<your-subdomain>.workers.dev`. Then:

1. **Lock it to your site** (recommended): in `wrangler.toml` set `ALLOWED_ORIGINS` to the web app's origin, e.g. `"https://r0n1n9.github.io"` (the origin serving the app, not the sites that embed it), and deploy again. Or set it in the dashboard under Workers → vigilante-proxy → Settings → Variables.
2. **Point the web build at it**: in GitHub, Settings → Secrets and variables → Actions → Variables, add `VITE_PROXY_URL` with the Worker URL. Re-run the Pages workflow. Locally: `VITE_PROXY_URL=https://... npm run build:web`.
3. **Optional global rate limit**: uncomment the `[[ratelimits]]` block in `wrangler.toml`.

Try it:

```bash
curl -s "https://vigilante-proxy.<you>.workers.dev/?url=https%3A%2F%2Fapi.weather.gov%2Falerts%2Factive%3Farea%3DCO" | head -c 200
curl -i "https://vigilante-proxy.<you>.workers.dev/?url=https%3A%2F%2Fexample.com%2F"   # 403 host not allowed
```

Adding a data source means adding its host to `config/hosts.json`; the desktop core, the dev proxy and this Worker all read that one file. Redeploy the Worker afterwards.

## Develop

```bash
cd web/proxy && npx wrangler dev     # http://localhost:8787/?url=...
npx vitest run tests/proxy.test.ts   # from the repo root: allowlist, redirects, headers, rate limit
```
