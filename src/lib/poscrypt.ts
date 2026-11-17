/**
 * End-to-end encrypted position reports for phone check-in.
 *
 * Positions travel over a public ntfy topic, so each one is sealed with
 * AES-256-GCM under a key that only exists in the channel's invite. The ntfy
 * server (and anyone who guesses the topic) sees only ciphertext.
 */

/** What a device can choose to share. Each category is a separate opt-in on the phone. */
export type ShareCategory = 'loc' | 'bat' | 'motion' | 'hr' | 'env' | 'profile';

export const SHARE_LABEL: Record<ShareCategory, string> = { loc: 'location', bat: 'battery', motion: 'motion', hr: 'heart rate', env: 'environment', profile: 'contact' };

/** Role and contact details a person chose to share with their team (category 'profile'). */
export interface Profile {
  role?: string;
  unit?: string;
  phone?: string;
  email?: string;
}

export type Activity = 'still' | 'walking' | 'running' | 'cycling' | 'driving' | 'unknown';

/**
 * One report from a phone (the web check-in page or the Vigil app). Version 1;
 * every field except v, id, n, t and s is optional, and receivers ignore
 * fields they don't know. Spec: docs/TEAM_PROTOCOL.md.
 */
export interface PositionReport {
  v: 1;
  /** Stable random id for this phone. */
  id: string;
  /** Callsign. */
  n: string;
  /** Location (only when the person shares 'loc'). */
  lat?: number;
  lon?: number;
  /** Which app sent it, and its version. */
  app?: 'field' | 'vigil' | string;
  ver?: string;
  /** Categories the person is sharing right now. Missing means ['loc'] (older senders). */
  perm?: ShareCategory[];
  /** Altitude in meters and its accuracy. */
  alt?: number;
  /** Charging (with 'bat'). */
  chg?: boolean;
  /** Motion activity (with 'motion'). */
  act?: Activity;
  /** Heart rate in beats per minute from a paired wearable (with 'hr'). */
  hr?: number;
  /** Environment sensors (with 'env'): light lux, pressure hPa, noise dB. */
  env?: { lux?: number; hpa?: number; db?: number };
  /** Role and contact details (with 'profile'). */
  prof?: Profile;
  /** Accuracy in meters. */
  acc?: number;
  /** Speed m/s and heading degrees, when the phone knows them. */
  spd?: number;
  hdg?: number;
  /** Battery 0-100 when available. */
  bat?: number;
  /** When the fix was taken (epoch ms). */
  t: number;
  /** 'on' while sharing; 'off' when the person stops; 'dark' = stealth: hide me now, keep no last position. */
  s: 'on' | 'off' | 'dark';
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

/** Seal any JSON object the same way (AES-256-GCM, random IV) under a prefix such as VGP1 or VGO1. */
export async function sealJson(key: string, obj: unknown, prefix = 'VGP1'): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `${prefix}.${b64url(out)}`;
}

export async function openJson<T>(key: string, text: string, prefix = 'VGP1'): Promise<T | null> {
  const m = new RegExp(`^${prefix}\\.([A-Za-z0-9_-]+)$`).exec(text.trim());
  if (!m) return null;
  try {
    const raw = unb64url(m[1]);
    if (raw.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await importKey(key), raw.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
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
    if (r.v !== 1 || typeof r.id !== 'string' || !['on', 'off', 'dark'].includes(r.s) || !Number.isFinite(r.t)) return null;
    const hasLoc = r.lat != null || r.lon != null;
    if (hasLoc && (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || Math.abs(r.lat!) > 90 || Math.abs(r.lon!) > 180)) return null;
    const out: PositionReport = { ...r, n: String(r.n ?? '').slice(0, 32) || 'Phone', id: r.id.slice(0, 40) };
    // Honour the sender's permissions: drop anything they haven't opted into.
    const perm = Array.isArray(r.perm) ? r.perm : ['loc'];
    if (!perm.includes('loc')) delete out.lat, delete out.lon, delete out.alt, delete out.acc, delete out.spd, delete out.hdg;
    if (!perm.includes('bat')) delete out.bat, delete out.chg;
    if (!perm.includes('motion')) delete out.act;
    if (!perm.includes('hr')) delete out.hr;
    if (!perm.includes('env')) delete out.env;
    if (!perm.includes('profile') || typeof r.prof !== 'object' || !r.prof) delete out.prof;
    else out.prof = cleanProfile(r.prof);
    if (r.s === 'dark') return { v: 1, id: out.id, n: out.n, t: r.t, s: 'dark', app: r.app };
    return out;
  } catch {
    return null;
  }
}

/** Positions ride on a sibling topic so ntfy app users in the chat don't get them as notifications. */
/** Keep profile fields short and well-formed; drop anything that isn't a plausible phone or email. */
export function cleanProfile(p: Profile): Profile | undefined {
  const t = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, n) : '');
  const phone = t(p.phone, 24);
  const email = t(p.email, 80);
  const out: Profile = {
    ...(t(p.role, 40) ? { role: t(p.role, 40) } : {}),
    ...(t(p.unit, 40) ? { unit: t(p.unit, 40) } : {}),
    ...(/^\+?[0-9 ().-]{6,24}$/.test(phone) ? { phone } : {}),
    ...(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? { email } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

export const posTopic = (topic: string) => `${topic}-pos`;
