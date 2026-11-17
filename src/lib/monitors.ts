import { distanceM, type LonLat } from './geo';
import type { Severity, Signal, SignalSource } from './signals';

/**
 * Monitors are user-defined alert rules. Four kinds:
 *  - keyword:   any new report whose text matches (news, crime, traffic, weather...)
 *  - proximity: anything reported within a radius of a point (a client's home, a site, a route stop)
 *  - aircraft:  a watchlist of callsigns, registrations, ICAO hex codes or aircraft types
 *  - threshold: a live number crossing a line (stability, AQI, outages, violent reports, feeds down...)
 */
export type MonitorKind = 'keyword' | 'proximity' | 'aircraft' | 'threshold';
export type Metric = 'stability' | 'aqi' | 'outageCustomers' | 'violent48h' | 'helos' | 'orbits' | 'feedsDown' | 'nwsAlerts';

export interface MonitorActions {
  desktop: boolean;
  sound: boolean;
  phone: boolean;
  webhook: boolean;
}

export interface Monitor {
  id: string;
  name: string;
  enabled: boolean;
  kind: MonitorKind;
  /** Severity given to hits from this monitor (keyword/proximity hits take the higher of this and the report's own). */
  severity: Severity;
  /** keyword/proximity: ignore reports below this severity. */
  minSeverity: Severity;
  /** keyword/proximity: limit to these sources; empty means all. */
  sources: SignalSource[];
  keywords: string[];
  center: LonLat | null;
  radiusM: number;
  aircraft: string[];
  metric: Metric;
  op: 'above' | 'below';
  value: number;
  actions: MonitorActions;
  /** Don't fire the same monitor for the same thing again within this many minutes. */
  cooldownMin: number;
  /** Send phone/webhook even during quiet hours. */
  breakQuiet: boolean;
  /** Re-send until acknowledged, every this many minutes (0 = off). */
  escalateMin: number;
}

export interface MonitorHit {
  id: string;
  monitorId: string;
  monitorName: string;
  at: number;
  title: string;
  detail: string;
  severity: Severity;
  location: LonLat | null;
  url?: string;
  hex?: string;
  acked: boolean;
  /** Times this hit has been re-sent by escalation. */
  escalations: number;
}

export const METRIC_LABEL: Record<Metric, string> = {
  stability: 'Stability index',
  aqi: 'Air quality (AQI)',
  outageCustomers: 'Customers without power',
  violent48h: 'Violent reports in 48 h',
  helos: 'Helicopters airborne',
  orbits: 'Aircraft circling',
  feedsDown: 'Data feeds failing',
  nwsAlerts: 'Active weather alerts',
};

export const KIND_LABEL: Record<MonitorKind, string> = {
  keyword: 'Keywords',
  proximity: 'Radius around a point',
  aircraft: 'Aircraft watchlist',
  threshold: 'Threshold',
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function newMonitor(kind: MonitorKind, patch: Partial<Monitor> = {}): Monitor {
  return {
    id: uid(),
    name: KIND_LABEL[kind],
    enabled: true,
    kind,
    severity: 2,
    minSeverity: 1,
    sources: [],
    keywords: [],
    center: null,
    radiusM: 1609,
    aircraft: [],
    metric: 'stability',
    op: kind === 'threshold' ? 'below' : 'above',
    value: 60,
    actions: { desktop: true, sound: true, phone: false, webhook: false },
    cooldownMin: 30,
    breakQuiet: false,
    escalateMin: 0,
    ...patch,
  };
}

/** Starter monitors a security team typically wants. */
export const TEMPLATES: { label: string; make: () => Monitor }[] = [
  { label: 'Shots fired / active threat (keywords)', make: () => newMonitor('keyword', { name: 'Active threat keywords', keywords: ['shooting', 'shots fired', 'active shooter', 'gunfire', 'stabbing', 'barricaded', 'hostage', 'swat', 'lockdown', 'bomb threat'], severity: 3, minSeverity: 0 }) },
  { label: 'Anything within 1 mile of a site', make: () => newMonitor('proximity', { name: 'Site perimeter (1 mi)', radiusM: 1609, minSeverity: 1 }) },
  { label: 'Police and news helicopters', make: () => newMonitor('aircraft', { name: 'Helicopter watchlist', aircraft: ['type:heli'], severity: 1, cooldownMin: 60 }) },
  { label: 'Stability drops below 60', make: () => newMonitor('threshold', { name: 'Stability below 60', metric: 'stability', op: 'below', value: 60, severity: 2, cooldownMin: 120 }) },
  { label: 'Power outage over 1,000 customers', make: () => newMonitor('threshold', { name: 'Major power outage', metric: 'outageCustomers', op: 'above', value: 1000, severity: 2, cooldownMin: 180 }) },
  { label: 'Data feeds failing (system health)', make: () => newMonitor('threshold', { name: 'Feed health', metric: 'feedsDown', op: 'above', value: 3, severity: 1, cooldownMin: 60, actions: { desktop: true, sound: false, phone: false, webhook: false } }) },
];

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ');

/** Keyword match: case-insensitive, whole words; "quoted phrases" are typed as plain phrases. */
export function matchesKeywords(text: string, keywords: string[]): string | null {
  const t = ` ${norm(text).replace(/[^a-z0-9#&' -]/g, ' ')} `;
  for (const k of keywords) {
    const w = norm(k.trim());
    if (!w) continue;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t)) return k.trim();
  }
  return null;
}

/** Does a new report trigger a keyword or proximity monitor? Returns a reason, or null. */
export function matchSignal(m: Monitor, sig: Signal): string | null {
  if (!m.enabled || (m.kind !== 'keyword' && m.kind !== 'proximity')) return null;
  if (sig.severity < m.minSeverity) return null;
  if (m.sources.length && !m.sources.includes(sig.source)) return null;
  if (m.kind === 'keyword') {
    const k = matchesKeywords(`${sig.title} ${sig.detail}`, m.keywords);
    return k ? `matched "${k}"` : null;
  }
  if (!m.center || !sig.location) return null;
  const d = distanceM(sig.location, m.center);
  if (d > m.radiusM) return null;
  return d < 1609 ? `${Math.round(d * 3.281).toLocaleString('en-US')} ft from ${m.name}` : `${(d / 1609).toFixed(1)} mi from ${m.name}`;
}

export interface AircraftLike {
  hex: string;
  callsign: string;
  reg: string;
  type: string;
  kind: string;
  military: boolean;
  emergency: string | null;
}

/**
 * Watchlist entries: a callsign or registration prefix ("N123", "FLIGHT"),
 * a hex code ("a1b2c3"), "type:<ICAO type>" ("type:AS50"), or a class
 * ("type:heli", "type:military", "type:emergency").
 */
export function matchAircraft(m: Monitor, a: AircraftLike): string | null {
  if (!m.enabled || m.kind !== 'aircraft') return null;
  for (const raw of m.aircraft) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e.startsWith('type:')) {
      const t = e.slice(5);
      if ((t === 'heli' && a.kind === 'heli') || (t === 'military' && a.military) || (t === 'emergency' && a.emergency) || (t && a.type.toLowerCase() === t)) return raw.trim();
      continue;
    }
    if (a.hex.toLowerCase() === e || a.callsign.toLowerCase().startsWith(e) || a.reg.toLowerCase().startsWith(e)) return raw.trim();
  }
  return null;
}

export function crosses(m: Monitor, value: number | null | undefined): boolean {
  if (!m.enabled || m.kind !== 'threshold' || value == null || Number.isNaN(value)) return false;
  return m.op === 'above' ? value > m.value : value < m.value;
}

/** Cooldown: may this monitor fire again for this key? */
export function cooledDown(last: number | undefined, now: number, cooldownMin: number): boolean {
  return last == null || now - last >= cooldownMin * 60_000;
}

/** Unacknowledged hits due for another notification. */
export function dueForEscalation(hits: MonitorHit[], monitors: Monitor[], now: number): MonitorHit[] {
  const byId = new Map(monitors.map((m) => [m.id, m]));
  return hits.filter((h) => {
    const m = byId.get(h.monitorId);
    if (!m || h.acked || !m.escalateMin) return false;
    return now - h.at >= (h.escalations + 1) * m.escalateMin * 60_000 && h.escalations < 10;
  });
}
