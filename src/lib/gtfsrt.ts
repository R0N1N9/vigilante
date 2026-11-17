import { fields, float, int, str, type Field } from './protobuf';

/** GTFS-Realtime decoding (https://gtfs.org/realtime/reference/), only the parts the console uses. */

export const CAUSES = ['', 'Unknown cause', 'Other cause', 'Technical problem', 'Strike', 'Demonstration', 'Accident', 'Holiday', 'Weather', 'Maintenance', 'Construction', 'Police activity', 'Medical emergency'];
export const EFFECTS = ['', 'No service', 'Reduced service', 'Significant delays', 'Detour', 'Additional service', 'Modified service', 'Other effect', 'Unknown effect', 'Stop moved', 'No effect', 'Accessibility issue'];

export interface RtAlert {
  id: string;
  activePeriods: { start: number; end: number }[]; // epoch seconds, 0 = open
  routes: string[];
  stops: string[];
  cause: number;
  effect: number;
  header: string;
  description: string;
  url: string;
  severityLevel: number; // 1 unknown, 2 info, 3 warning, 4 severe
}

export interface RtTripUpdate {
  tripId: string;
  routeId: string;
  canceled: boolean;
  delaySec: number | null; // first stop update with a known delay
  vehicleId: string;
  timestamp: number;
}

export interface RtVehicle {
  id: string;
  label: string;
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  bearing: number | null;
  timestamp: number;
}

function translated(b: Uint8Array): string {
  const out: { text: string; lang: string }[] = [];
  for (const f of fields(b)) {
    if (f.no !== 1 || !f.bytes) continue;
    let text = '';
    let lang = '';
    for (const t of fields(f.bytes)) {
      if (t.no === 1) text = str(t);
      else if (t.no === 2) lang = str(t);
    }
    out.push({ text, lang });
  }
  return (out.find((t) => !t.lang || t.lang.startsWith('en')) ?? out[0])?.text ?? '';
}

function trip(b: Uint8Array) {
  let tripId = '';
  let routeId = '';
  let rel = 0;
  for (const f of fields(b)) {
    if (f.no === 1) tripId = str(f);
    else if (f.no === 5) routeId = str(f);
    else if (f.no === 4 && f.wire === 0) rel = f.varint ?? 0;
  }
  return { tripId, routeId, canceled: rel === 3 };
}

function entities(feed: Uint8Array): Field[] {
  return [...fields(feed)].filter((f) => f.no === 2 && f.bytes);
}

export function decodeAlerts(feed: Uint8Array): RtAlert[] {
  const out: RtAlert[] = [];
  for (const e of entities(feed)) {
    let id = '';
    let alertBytes: Uint8Array | null = null;
    for (const f of fields(e.bytes!)) {
      if (f.no === 1) id = str(f);
      else if (f.no === 5 && f.bytes) alertBytes = f.bytes;
    }
    if (!alertBytes) continue;
    const a: RtAlert = { id, activePeriods: [], routes: [], stops: [], cause: 1, effect: 8, header: '', description: '', url: '', severityLevel: 1 };
    for (const f of fields(alertBytes)) {
      if (f.no === 1 && f.bytes) {
        let start = 0;
        let end = 0;
        for (const t of fields(f.bytes)) {
          if (t.no === 1) start = t.varint ?? 0;
          else if (t.no === 2) end = t.varint ?? 0;
        }
        a.activePeriods.push({ start, end });
      } else if (f.no === 5 && f.bytes) {
        for (const s of fields(f.bytes)) {
          if (s.no === 2 && str(s)) a.routes.push(str(s));
          else if (s.no === 5 && str(s)) a.stops.push(str(s));
          else if (s.no === 4 && s.bytes) {
            const t = trip(s.bytes);
            if (t.routeId) a.routes.push(t.routeId);
          }
        }
      } else if (f.no === 6) a.cause = f.varint ?? 1;
      else if (f.no === 7) a.effect = f.varint ?? 8;
      else if (f.no === 8 && f.bytes) a.url = translated(f.bytes);
      else if (f.no === 10 && f.bytes) a.header = translated(f.bytes);
      else if (f.no === 11 && f.bytes) a.description = translated(f.bytes);
      else if (f.no === 14) a.severityLevel = f.varint ?? 1;
    }
    a.routes = [...new Set(a.routes)];
    a.stops = [...new Set(a.stops)];
    out.push(a);
  }
  return out;
}

export function isActive(a: RtAlert, nowSec: number): boolean {
  if (!a.activePeriods.length) return true;
  return a.activePeriods.some((p) => (!p.start || p.start <= nowSec) && (!p.end || p.end >= nowSec));
}

/** StopTimeEvent: delay (field 1) if present, else predicted time (2) minus scheduled time (4). */
function eventDelay(b: Uint8Array): number | null {
  let delay: number | null = null;
  let time = 0;
  let scheduled = 0;
  for (const f of fields(b)) {
    if (f.no === 1) delay = int(f);
    else if (f.no === 2) time = f.varint ?? 0;
    else if (f.no === 4) scheduled = f.varint ?? 0;
  }
  if (delay != null) return delay;
  return time && scheduled ? time - scheduled : null;
}

export function decodeTripUpdates(feed: Uint8Array): RtTripUpdate[] {
  const out: RtTripUpdate[] = [];
  for (const e of entities(feed)) {
    for (const f of fields(e.bytes!)) {
      if (f.no !== 3 || !f.bytes) continue;
      const u: RtTripUpdate = { tripId: '', routeId: '', canceled: false, delaySec: null, vehicleId: '', timestamp: 0 };
      for (const g of fields(f.bytes)) {
        if (g.no === 1 && g.bytes) Object.assign(u, trip(g.bytes));
        else if (g.no === 3 && g.bytes) {
          for (const v of fields(g.bytes)) if (v.no === 1) u.vehicleId = str(v);
        } else if (g.no === 4) u.timestamp = g.varint ?? 0;
        else if (g.no === 5) u.delaySec = int(g);
        else if (g.no === 2 && g.bytes && u.delaySec == null) {
          for (const s of fields(g.bytes)) {
            if ((s.no === 2 || s.no === 3) && s.bytes && u.delaySec == null) u.delaySec = eventDelay(s.bytes);
          }
        }
      }
      out.push(u);
    }
  }
  return out;
}

export function decodeVehicles(feed: Uint8Array): RtVehicle[] {
  const out: RtVehicle[] = [];
  for (const e of entities(feed)) {
    for (const f of fields(e.bytes!)) {
      if (f.no !== 4 || !f.bytes) continue;
      const v: RtVehicle = { id: '', label: '', tripId: '', routeId: '', lat: 0, lon: 0, bearing: null, timestamp: 0 };
      for (const g of fields(f.bytes)) {
        if (g.no === 1 && g.bytes) {
          const t = trip(g.bytes);
          v.tripId = t.tripId;
          v.routeId = t.routeId;
        } else if (g.no === 2 && g.bytes) {
          for (const p of fields(g.bytes)) {
            if (p.no === 1) v.lat = float(p);
            else if (p.no === 2) v.lon = float(p);
            else if (p.no === 3) v.bearing = float(p);
          }
        } else if (g.no === 5) v.timestamp = g.varint ?? 0;
        else if (g.no === 8 && g.bytes) {
          for (const d of fields(g.bytes)) {
            if (d.no === 1) v.id = str(d);
            else if (d.no === 2) v.label = str(d);
          }
        }
      }
      if (v.lat && v.lon) out.push(v);
    }
  }
  return out;
}
