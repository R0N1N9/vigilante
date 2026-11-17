/**
 * Team channels: group chat over ntfy topics (internet) and Meshtastic
 * radios (off-grid LoRa mesh), plus invite links and shared map spots.
 */
import type { LonLat } from './geo';
import type { Severity } from './signals';

/** Where the hosted web app lives; invite links open it (or paste the code into the desktop app). */
export const WEB_APP_URL = 'https://r0n1n9.github.io/vigilante/';
export const MESHTASTIC_APP_URL = 'https://meshtastic.org/downloads/';
export const NTFY_APP_URL = 'https://ntfy.sh/';

export interface NtfyChannel {
  id: string;
  kind: 'ntfy';
  name: string;
  enabled: boolean;
  server: string;
  topic: string;
  /** Optional access token for a protected topic on your own ntfy server. */
  token: string;
  /** Post new reports at or above this level to the channel automatically (0 = off). */
  shareAlerts: Severity;
}

export interface MeshChannel {
  id: string;
  kind: 'mesh';
  name: string;
  enabled: boolean;
  /** Channel slot on the radio (0 = primary). */
  channelIndex: number;
  /** The channel's share link from the Meshtastic app (https://meshtastic.org/e/#…), for inviting people. */
  inviteUrl: string;
  shareAlerts: Severity;
}

export type TeamChannel = NtfyChannel | MeshChannel;

export interface SharedSpot {
  lat: number;
  lon: number;
  label?: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  at: number;
  from: string;
  text: string;
  mine: boolean;
  spot?: SharedSpot;
  url?: string;
  status?: 'sending' | 'sent' | 'failed';
  error?: string;
  /** Id on the transport (ntfy message id or mesh packet id), for de-duplication. */
  remoteId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  channelId: string;
  at: number;
  location: LonLat;
  source: 'mesh' | 'ntfy';
}

export interface MeshRadioSettings {
  transport: 'ble' | 'serial' | 'http';
  /** BLE: device name or id (empty = first radio found). Serial: port path. Wi-Fi: local IP or .local name. */
  address: string;
  autoConnect: boolean;
}

export const DEFAULT_MESH_RADIO: MeshRadioSettings = { transport: 'ble', address: '', autoConnect: false };

const uid = () => Math.random().toString(36).slice(2, 10);

/** A topic name that's hard to guess: on a public ntfy server the name is the only lock. */
export function randomTopic(prefix = 'vg-team'): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return `${prefix}-${[...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18)}`;
}

export function newNtfyChannel(patch: Partial<NtfyChannel> = {}): NtfyChannel {
  return { id: uid(), kind: 'ntfy', name: 'Team channel', enabled: true, server: 'https://ntfy.sh', topic: randomTopic(), token: '', shareAlerts: 0, ...patch };
}

export function newMeshChannel(patch: Partial<MeshChannel> = {}): MeshChannel {
  return { id: uid(), kind: 'mesh', name: 'Mesh primary', enabled: true, channelIndex: 0, inviteUrl: '', shareAlerts: 0, ...patch };
}

// ---------- Invites ----------

interface InviteV1 {
  v: 1;
  k: 'ntfy' | 'mesh';
  n: string;
  s?: string;
  t?: string;
  a?: string;
  c?: number;
  u?: string;
}

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function inviteCode(ch: TeamChannel, includeToken = true): string {
  const inv: InviteV1 =
    ch.kind === 'ntfy'
      ? { v: 1, k: 'ntfy', n: ch.name, s: ch.server, t: ch.topic, ...(includeToken && ch.token ? { a: ch.token } : {}) }
      : { v: 1, k: 'mesh', n: ch.name, c: ch.channelIndex, ...(ch.inviteUrl ? { u: ch.inviteUrl } : {}) };
  return `VG1.${b64url(JSON.stringify(inv))}`;
}

export const inviteLink = (ch: TeamChannel, includeToken = true) => `${WEB_APP_URL}#join=${inviteCode(ch, includeToken)}`;

/** Link for people without Vigilante: the ntfy web/phone app, or the Meshtastic channel URL. */
export function nativeLink(ch: TeamChannel): string | null {
  if (ch.kind === 'mesh') return ch.inviteUrl || null;
  const host = ch.server.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/${ch.topic}`;
}

/** Deep link that subscribes in the ntfy phone app. */
export function ntfyAppLink(ch: NtfyChannel): string {
  const host = ch.server.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `ntfy://${host}/${ch.topic}`;
}

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MESH_URL_RE = /^https:\/\/meshtastic\.org\/e\/#[A-Za-z0-9_-]+$/;

/**
 * Turn anything a teammate might paste into a channel: a Vigilante invite
 * code or link, an ntfy topic URL (https://ntfy.sh/topic or ntfy://…), or a
 * Meshtastic channel URL. Returns null if it isn't one of those.
 */
export function parseInvite(input: string): TeamChannel | null {
  const raw = input.trim();
  const code = /VG1\.([A-Za-z0-9_-]+)/.exec(raw)?.[1];
  if (code) {
    try {
      const inv = JSON.parse(unb64url(code)) as InviteV1;
      if (inv.v !== 1) return null;
      if (inv.k === 'ntfy' && inv.s && inv.t && /^https:\/\//.test(inv.s) && TOPIC_RE.test(inv.t)) return newNtfyChannel({ name: String(inv.n || 'Team channel').slice(0, 60), server: inv.s, topic: inv.t, token: inv.a ?? '' });
      if (inv.k === 'mesh') return newMeshChannel({ name: String(inv.n || 'Mesh').slice(0, 60), channelIndex: Math.max(0, Math.min(7, Number(inv.c) || 0)), inviteUrl: inv.u && MESH_URL_RE.test(inv.u) ? inv.u : '' });
    } catch {
      return null;
    }
    return null;
  }
  if (MESH_URL_RE.test(raw)) return newMeshChannel({ name: 'Mesh channel', inviteUrl: raw });
  const m = /^(https|ntfy):\/\/([a-z0-9.-]+(?::\d+)?)\/([A-Za-z0-9_-]{1,64})\/?$/i.exec(raw);
  if (m) return newNtfyChannel({ name: m[3], server: `https://${m[2]}`, topic: m[3] });
  return null;
}

// ---------- Shared spots ----------

export const spotUrl = (s: SharedSpot) => `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(5)}&mlon=${s.lon.toFixed(5)}#map=16/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`;

/** Find a shared spot in a link (OpenStreetMap, Google Maps, geo:) or an "@lat,lon" tag in text. */
export function parseSpot(text: string, url?: string): SharedSpot | null {
  const tryNums = (lat: number, lon: number) => (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null);
  for (const s of [url ?? '', text]) {
    let m = /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/.exec(s);
    if (m) return tryNums(+m[1], +m[2]);
    m = /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s);
    if (m) return tryNums(+m[1], +m[2]);
    m = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s);
    if (m) return tryNums(+m[1], +m[2]);
    m = /@(-?\d{1,2}\.\d{3,}),\s?(-?\d{1,3}\.\d{3,})/.exec(s);
    if (m) return tryNums(+m[1], +m[2]);
  }
  return null;
}

/** Compact text form for the mesh (no links; ~200 bytes max). */
export function meshText(text: string, spot?: SharedSpot): string {
  const tag = spot ? ` @${spot.lat.toFixed(5)},${spot.lon.toFixed(5)}` : '';
  const enc = new TextEncoder();
  let body = text.trim();
  while (enc.encode(body + tag).length > 200 && body.length) body = body.slice(0, -1);
  return (body + tag).trim();
}

// ---------- ntfy wire format ----------

export interface NtfyEvent {
  id: string;
  time: number;
  event: string;
  topic: string;
  title?: string;
  message?: string;
  tags?: string[];
  click?: string;
}

/** Our own messages carry a tag with this install's id, so we recognise our echo. */
export const installTag = (installId: string) => `vg-${installId}`;

export function ntfyToMessage(e: NtfyEvent, channelId: string, installId: string): ChatMessage | null {
  if (e.event !== 'message') return null;
  const text = (e.message ?? '').trim();
  if (!text) return null;
  const spot = parseSpot(text, e.click) ?? undefined;
  return {
    id: `ntfy:${e.id}`,
    remoteId: e.id,
    channelId,
    at: e.time * 1000,
    from: e.title?.trim() || (e.tags?.includes('vigilante') ? 'Vigilante' : 'ntfy app'),
    text,
    mine: !!e.tags?.includes(installTag(installId)),
    spot,
    url: e.click,
    status: 'sent',
  };
}

/** JSON body for publishing to ntfy (POST to the server root). */
export function ntfyPublishBody(ch: NtfyChannel, from: string, text: string, installId: string, spot?: SharedSpot, url?: string) {
  const click = url ?? (spot ? spotUrl(spot) : undefined);
  return {
    topic: ch.topic,
    title: from,
    message: text,
    tags: ['vigilante', installTag(installId)],
    ...(click ? { click, actions: [{ action: 'view', label: spot ? 'Map' : 'Open', url: click }] } : {}),
  };
}

/** SSE URL with history since a point and optional token (ntfy accepts the auth header as a query parameter). */
export function ntfyStreamUrl(ch: NtfyChannel, since: string): string {
  const base = `${ch.server.replace(/\/$/, '')}/${ch.topic}/sse?since=${encodeURIComponent(since)}`;
  if (!ch.token) return base;
  const auth = b64url(`Bearer ${ch.token}`);
  return `${base}&auth=${auth}`;
}
