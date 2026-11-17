/**
 * End-to-end encrypted position reports for phone check-in.
 *
 * Positions travel over a public ntfy topic, so each one is sealed with
 * AES-256-GCM under a key that only exists in the channel's invite. The ntfy
 * server (and anyone who guesses the topic) sees only ciphertext.
 */

export interface PositionReport {
  v: 1;
  /** Stable random id for this phone. */
  id: string;
  /** Callsign. */
  n: string;
  lat: number;
  lon: number;
  /** Accuracy in meters. */
  acc?: number;
  /** Speed m/s and heading degrees, when the phone knows them. */
  spd?: number;
  hdg?: number;
  /** Battery 0-100 when available. */
  bat?: number;
  /** When the fix was taken (epoch ms). */
  t: number;
  /** 'on' while sharing; 'off' when the person stops. */
  s: 'on' | 'off';
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function newPosKey(): string {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return b64url(k);
}

export const isPosKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{43}$/.test(k);

const keyCache = new Map<string, Promise<CryptoKey>>();
function importKey(k: string): Promise<CryptoKey> {
  let p = keyCache.get(k);
  if (!p) {
    p = crypto.subtle.importKey('raw', unb64url(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(k, p);
  }
  return p;
}

export async function sealPosition(key: string, r: PositionReport): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), enc.encode(JSON.stringify(r))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `VGP1.${b64url(out)}`;
}

/** Returns null for anything that isn't a valid report sealed with this key. */
export async function openPosition(key: string, text: string): Promise<PositionReport | null> {
  const m = /^VGP1\.([A-Za-z0-9_-]+)$/.exec(text.trim());
  if (!m) return null;
  try {
    const raw = unb64url(m[1]);
    if (raw.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await importKey(key), raw.slice(12));
    const r = JSON.parse(dec.decode(pt)) as PositionReport;
    if (r.v !== 1 || typeof r.id !== 'string' || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return null;
    return { ...r, n: String(r.n ?? '').slice(0, 32) || 'Phone', id: r.id.slice(0, 40) };
  } catch {
    return null;
  }
}

/** Positions ride on a sibling topic so ntfy app users in the chat don't get them as notifications. */
export const posTopic = (topic: string) => `${topic}-pos`;
