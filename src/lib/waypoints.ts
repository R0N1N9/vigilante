/**
 * Waypoints: places the console sends to agents (rally points, posts,
 * incidents to check). Sent encrypted on the channel's ops topic; phones
 * answer with acknowledgements. Spec: docs/TEAM_PROTOCOL.md §4.
 */
import { distanceM, type LonLat } from './geo';
import { openJson, sealJson } from './poscrypt';

export type WaypointPriority = 'routine' | 'urgent';
export type AckState = 'ack' | 'enroute' | 'arrived' | 'declined';

export interface WaypointAck {
  state: AckState;
  at: number;
  name: string;
  /** Set by the console when the agent's own position reached the waypoint. */
  auto?: boolean;
}

export interface Waypoint {
  id: string;
  channelId: string;
  name: string;
  note: string;
  location: LonLat;
  /** Device ids of the agents it's for; empty means everyone on the channel. */
  to: string[];
  priority: WaypointPriority;
  state: 'active' | 'done' | 'cancelled';
  by: string;
  at: number;
  acks: Record<string, WaypointAck>;
}

/** Wire messages on the ops topic (sealed with the channel's position key, prefix VGO1). */
export type OpsMessage =
  | { v: 1; type: 'wp'; id: string; name: string; note?: string; lat: number; lon: number; to: string[]; pri: WaypointPriority; state: Waypoint['state']; by: string; t: number }
  | { v: 1; type: 'wp-ack'; wp: string; id: string; n: string; state: AckState; t: number }
  | MarkMessage;

// ---------------------------------------------------------------- marks ---

/**
 * Marks: shared map annotations anyone on the team can place, edit or clear.
 * ping: "look here", expires on its own · marker: point of interest ·
 * area: circle of interest · objective: a goal with a status.
 */
export type MarkKind = 'ping' | 'marker' | 'area' | 'objective';
export type MarkState = 'active' | 'progress' | 'done' | 'cleared';

export const MARK_CATEGORIES = {
  general: 'General',
  hazard: 'Hazard',
  entry: 'Entry / exit',
  rally: 'Rally point',
  observation: 'Observation post',
  vehicle: 'Vehicle',
  activity: 'Suspicious activity',
  medical: 'Medical',
  staging: 'Staging',
} as const;
export type MarkCategory = keyof typeof MARK_CATEGORIES;

export const MARK_KIND_LABEL: Record<MarkKind, string> = { ping: 'Ping', marker: 'Marker', area: 'Area of interest', objective: 'Objective' };
export const MARK_STATE_LABEL: Record<MarkState, string> = { active: 'Active', progress: 'In progress', done: 'Done', cleared: 'Cleared' };

/** Pings fade out on their own unless the sender sets another lifetime. */
export const PING_TTL_S = 15 * 60;

export interface Mark {
  id: string;
  channelId: string;
  kind: MarkKind;
  cat: MarkCategory;
  name: string;
  desc: string;
  location: LonLat;
  /** Areas: radius in meters. */
  radiusM?: number;
  state: MarkState;
  /** Callsign and device/console id of whoever last changed it. */
  by: string;
  byId: string;
  at: number;
  /** Seconds after `at` when it disappears (pings); 0 or absent = until cleared. */
  ttlS?: number;
}

export type MarkMessage = {
  v: 1;
  type: 'mark';
  id: string;
  kind: MarkKind;
  cat: MarkCategory;
  name: string;
  desc?: string;
  lat: number;
  lon: number;
  r?: number;
  state: MarkState;
  by: string;
  byId: string;
  t: number;
  ttl?: number;
};

export const markToWire = (m: Mark): MarkMessage => ({
  v: 1,
  type: 'mark',
  id: m.id,
  kind: m.kind,
  cat: m.cat,
  name: m.name,
  desc: m.desc,
  lat: m.location[1],
  lon: m.location[0],
  ...(m.kind === 'area' && m.radiusM ? { r: Math.round(m.radiusM) } : {}),
  state: m.state,
  by: m.by,
  byId: m.byId,
  t: m.at,
  ...(m.ttlS ? { ttl: m.ttlS } : {}),
});

export const markFromWire = (m: MarkMessage, channelId: string): Mark => ({
  id: m.id,
  channelId,
  kind: m.kind,
  cat: m.cat,
  name: m.name,
  desc: m.desc ?? '',
  location: [m.lon, m.lat],
  ...(m.kind === 'area' && m.r ? { radiusM: m.r } : {}),
  state: m.state,
  by: m.by,
  byId: m.byId,
  at: m.t,
  ...(m.ttl ? { ttlS: m.ttl } : {}),
});

/** Still worth showing? Cleared marks and expired pings drop off. */
export const markLive = (m: Pick<Mark, 'state' | 'at' | 'ttlS'>, now = Date.now()) => m.state !== 'cleared' && !(m.ttlS && now > m.at + m.ttlS * 1000);

function validMark(m: MarkMessage): MarkMessage | null {
  if (typeof m.id !== 'string' || !m.id || !Number.isFinite(m.lat) || !Number.isFinite(m.lon) || Math.abs(m.lat) > 90 || Math.abs(m.lon) > 180) return null;
  if (!(m.kind in MARK_KIND_LABEL) || !(m.state in MARK_STATE_LABEL)) return null;
  const r = m.kind === 'area' ? Math.max(10, Math.min(20_000, Number(m.r) || 100)) : undefined;
  const ttl = Number(m.ttl) > 0 ? Math.min(7 * 86_400, Number(m.ttl)) : m.kind === 'ping' ? PING_TTL_S : undefined;
  return {
    v: 1,
    type: 'mark',
    id: m.id.slice(0, 40),
    kind: m.kind,
    cat: (m.cat in MARK_CATEGORIES ? m.cat : 'general') as MarkCategory,
    name: String(m.name ?? MARK_KIND_LABEL[m.kind]).slice(0, 60),
    desc: String(m.desc ?? '').slice(0, 500),
    lat: m.lat,
    lon: m.lon,
    ...(r ? { r } : {}),
    state: m.state,
    by: String(m.by ?? '').slice(0, 32),
    byId: String(m.byId ?? '').slice(0, 40),
    t: Number(m.t) || 0,
    ...(ttl ? { ttl } : {}),
  };
}

export const opsTopic = (topic: string) => `${topic}-ops`;
export const ARRIVE_M = 40;

export const ACK_LABEL: Record<AckState, string> = { ack: 'Acknowledged', enroute: 'En route', arrived: 'Arrived', declined: "Can't make it" };

export const sealOps = (key: string, m: OpsMessage) => sealJson(key, m, 'VGO1');

/** Decrypt and sanity-check an ops message. */
export async function openOps(key: string, text: string): Promise<OpsMessage | null> {
  const m = await openJson<OpsMessage>(key, text, 'VGO1');
  if (!m || m.v !== 1) return null;
  if (m.type === 'wp') {
    if (typeof m.id !== 'string' || !Number.isFinite(m.lat) || !Number.isFinite(m.lon) || Math.abs(m.lat) > 90 || Math.abs(m.lon) > 180) return null;
    if (!['active', 'done', 'cancelled'].includes(m.state) || !Array.isArray(m.to)) return null;
    return { ...m, name: String(m.name ?? 'Waypoint').slice(0, 60), note: String(m.note ?? '').slice(0, 300), pri: m.pri === 'urgent' ? 'urgent' : 'routine', to: m.to.map(String).slice(0, 50) };
  }
  if (m.type === 'mark') return validMark(m);
  if (m.type === 'wp-ack') {
    if (typeof m.wp !== 'string' || typeof m.id !== 'string' || !['ack', 'enroute', 'arrived', 'declined'].includes(m.state)) return null;
    return { ...m, n: String(m.n ?? '').slice(0, 32) };
  }
  return null;
}

export const toWire = (w: Waypoint): OpsMessage => ({ v: 1, type: 'wp', id: w.id, name: w.name, note: w.note, lat: w.location[1], lon: w.location[0], to: w.to, pri: w.priority, state: w.state, by: w.by, t: w.at });

export const isFor = (w: Pick<Waypoint, 'to'>, deviceId: string) => !w.to.length || w.to.includes(deviceId);

/** Has this agent reached the waypoint? */
export const reached = (w: Pick<Waypoint, 'location'>, at: LonLat | null) => !!at && distanceM(at, w.location) <= ARRIVE_M;

/** Links that open turn-by-turn directions in the phone's maps app. */
export function directionsLinks(lat: number, lon: number, name = 'Waypoint') {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(name)}`,
    /** Android intent Vigil can fire directly (falls back to geo:). */
    androidNav: `google.navigation:q=${ll}`,
    geo: `geo:${ll}?q=${ll}(${encodeURIComponent(name)})`,
  };
}

/** Device id from a console TeamMember id ("phone:<channel>:<device>"). */
export const deviceOf = (memberId: string) => (memberId.startsWith('phone:') ? memberId.split(':').slice(2).join(':') : null);
