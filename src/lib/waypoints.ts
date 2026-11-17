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
  | { v: 1; type: 'wp-ack'; wp: string; id: string; n: string; state: AckState; t: number };

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
