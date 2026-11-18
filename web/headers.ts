/**
 * Security headers for the hosted web app. Written to dist-web/_headers at build time
 * (Cloudflare Pages and Netlify read it) and sent by `npm run preview:web`.
 *
 * frame-ancestors * is deliberate: the app is meant to be embedded on any site.
 * It holds no logins or cookies, so framing it can't be used to act as a visitor.
 * GitHub Pages can't set headers; it sends no X-Frame-Options, so embeds work there
 * too, and the same policy (minus frame-ancestors, which browsers ignore in <meta>) ships in the HTML.
 */
const CSP: [string, string][] = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob: https:"],
  ['font-src', "'self' data:"],
  // Data comes through the proxy, but map tiles, ntfy (any server the user picks), Claude and AISstream are direct.
  ['connect-src', "'self' https: wss:"],
  ['worker-src', "'self' blob:"],
  ['child-src', "'self' blob: https:"],
  ['frame-src', 'https:'],
  ['media-src', "'self' https: blob:"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'none'"],
];

export const cspMeta = (): string => CSP.map(([k, v]) => `${k} ${v}`).join('; ');
export const cspHeader = (): string => `${cspMeta()}; frame-ancestors *`;

export function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': cspHeader(),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Location and microphone (push-to-talk on the phone page) only for this site itself; an embedding page must also grant them via iframe allow=.
    'Permissions-Policy': 'camera=(), microphone=(self), payment=(), usb=(), bluetooth=(), geolocation=(self)',
  };
}

/** Netlify / Cloudflare Pages `_headers` file. */
export function headersFile(): string {
  const lines = Object.entries(securityHeaders()).map(([k, v]) => `  ${k}: ${v}`);
  return [
    '/*',
    ...lines,
    '',
    '/embed.js',
    '  Cache-Control: public, max-age=300',
    '  Access-Control-Allow-Origin: *',
    '',
  ].join('\n');
}
