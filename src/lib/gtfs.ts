import { unzipSync } from 'fflate';
import type { LonLat } from './geo';

/** The parts of a static GTFS feed the console needs: stop locations and route names. */
export interface GtfsLite {
  fetchedAt: number;
  stops: Record<string, { name: string; at: LonLat }>;
  routes: Record<string, { short: string; long: string; type: number }>;
  tripRoute: Record<string, string>;
}

/** Small CSV parser that handles quoted fields (GTFS uses RFC 4180). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, '').trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function parseGtfsZip(zip: Uint8Array, withTrips = false): GtfsLite {
  const want = new Set(['stops.txt', 'routes.txt', ...(withTrips ? ['trips.txt'] : [])]);
  const files = unzipSync(zip, { filter: (f) => want.has(f.name.split('/').pop() ?? '') });
  const text = (name: string) => {
    const key = Object.keys(files).find((k) => k.endsWith(name));
    return key ? new TextDecoder().decode(files[key]) : '';
  };
  const stops: GtfsLite['stops'] = {};
  for (const s of parseCsv(text('stops.txt'))) {
    const lat = Number(s.stop_lat);
    const lon = Number(s.stop_lon);
    if (s.stop_id && lat && lon) stops[s.stop_id] = { name: s.stop_name, at: [lon, lat] };
  }
  const routes: GtfsLite['routes'] = {};
  for (const r of parseCsv(text('routes.txt'))) if (r.route_id) routes[r.route_id] = { short: r.route_short_name, long: r.route_long_name, type: Number(r.route_type) };
  const tripRoute: GtfsLite['tripRoute'] = {};
  if (withTrips) for (const t of parseCsv(text('trips.txt'))) if (t.trip_id) tripRoute[t.trip_id] = t.route_id;
  return { fetchedAt: Date.now(), stops, routes, tripRoute };
}

export function routeName(g: GtfsLite | null, routeId: string): string {
  const r = g?.routes[routeId];
  if (!r) return `Route ${routeId}`;
  const label = r.short || r.long || routeId;
  const kind = r.type === 0 ? 'Light rail' : r.type === 1 ? 'Rail' : r.type === 2 ? 'Train' : 'Bus';
  return /^\d+[A-Z]?$/.test(label) ? `${kind} ${label}` : `${label}${r.type === 3 ? '' : ` (${kind.toLowerCase()})`}`;
}
