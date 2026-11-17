import { centroid } from './areas';
import { distanceM, NM_TO_M, type LonLat } from './geo';
import { routeName, type GtfsLite } from './gtfs';
import { CAUSES, EFFECTS, isActive, type RtAlert, type RtTripUpdate, type RtVehicle } from './gtfsrt';
import type { Severity } from './signals';

export interface TransitDisruption {
  id: string;
  agency: 'RTD' | 'MARTA';
  title: string;
  detail: string;
  routes: string[];
  cause: string;
  effect: string;
  severity: Severity;
  location: LonLat | null; // representative point (stop or bus cluster)
  points: LonLat[]; // affected stops or late buses
  kind: 'alert' | 'delays';
  url?: string;
}

/** Police activity, medical emergencies and accidents are what a watch console cares about. */
export function alertSeverity(a: RtAlert): Severity {
  if (a.cause === 11 || a.cause === 12 || a.cause === 6) return 2;
  if (a.cause === 9 || a.cause === 10 || a.cause === 7) return 0; // planned maintenance/construction/holiday
  if (a.effect === 1 || a.effect === 3 || a.cause === 8 || a.severityLevel >= 4) return 1;
  return 0;
}

/** RTD service alerts (GTFS-RT) that are active now and touch the area. */
export function rtdDisruptions(alerts: RtAlert[], g: GtfsLite | null, center: LonLat, radiusNm: number, nowSec: number): TransitDisruption[] {
  const r = radiusNm * NM_TO_M;
  const out: TransitDisruption[] = [];
  for (const a of alerts) {
    if (!isActive(a, nowSec)) continue;
    const points = a.stops.map((s) => g?.stops[s]?.at).filter((p): p is LonLat => !!p);
    const inArea = points.filter((p) => distanceM(p, center) <= r);
    if (points.length && !inArea.length) continue; // stops known and all outside the area
    const near = inArea.length ? inArea : [];
    const location = near.length ? (near.length === 1 ? near[0] : nearestToCentroid(near)) : null;
    const routes = a.routes.map((x) => routeName(g, x));
    const firstLine = (a.header || a.description).split(/\r?\n/)[0];
    out.push({
      id: `rtd:${a.id}`,
      agency: 'RTD',
      title: routes.length ? `${routes.slice(0, 3).join(', ')}${routes.length > 3 ? ` +${routes.length - 3}` : ''}` : 'RTD service alert',
      detail: firstLine.slice(0, 220),
      routes,
      cause: CAUSES[a.cause] ?? '',
      effect: EFFECTS[a.effect] ?? '',
      severity: alertSeverity(a),
      location,
      points: near.slice(0, 40),
      kind: 'alert',
      url: a.url || undefined,
    });
  }
  return out.sort((x, y) => y.severity - x.severity);
}

function nearestToCentroid(points: LonLat[]): LonLat {
  const c = centroid(points);
  return points.reduce((best, p) => (distanceM(p, c) < distanceM(best, c) ? p : best), points[0]);
}

export interface DelayOptions {
  lateSec: number; // a bus this late counts as "late"
  maxSec: number; // larger "delays" are stale or bad data
  minLate: number; // late buses on one route to call it a disruption
}

export const DEFAULT_DELAY: DelayOptions = { lateSec: 15 * 60, maxSec: 2 * 3600, minLate: 2 };

/**
 * MARTA publishes no alerts feed, so disruptions are inferred from live trip
 * updates: routes with several buses running well behind schedule, located
 * by those buses' current positions.
 */
export function martaDisruptions(updates: RtTripUpdate[], vehicles: RtVehicle[], g: GtfsLite | null, center: LonLat, radiusNm: number, opts: DelayOptions = DEFAULT_DELAY): TransitDisruption[] {
  const r = radiusNm * NM_TO_M;
  const byTrip = new Map(vehicles.map((v) => [v.tripId, v]));
  const byVehicle = new Map(vehicles.map((v) => [v.id, v]));
  const groups = new Map<string, { late: { delay: number; at: LonLat }[] }>();
  for (const u of updates) {
    if (u.canceled || u.delaySec == null || u.delaySec < opts.lateSec || u.delaySec > opts.maxSec) continue;
    const v = byTrip.get(u.tripId) ?? byVehicle.get(u.vehicleId);
    if (!v) continue; // only count buses actually on the road
    const at: LonLat = [v.lon, v.lat];
    if (distanceM(at, center) > r) continue;
    const route = u.routeId || v.routeId || g?.tripRoute[u.tripId] || '';
    if (!route) continue;
    const grp = groups.get(route) ?? { late: [] };
    grp.late.push({ delay: u.delaySec, at });
    groups.set(route, grp);
  }
  const out: TransitDisruption[] = [];
  for (const [route, grp] of groups) {
    if (grp.late.length < opts.minLate) continue;
    const maxMin = Math.round(Math.max(...grp.late.map((l) => l.delay)) / 60);
    const points = grp.late.map((l) => l.at);
    const name = routeName(g, route);
    out.push({
      id: `marta:delay:${route}`,
      agency: 'MARTA',
      title: name,
      detail: `${grp.late.length} buses running ${Math.round(opts.lateSec / 60)}+ min late (worst ${maxMin} min)`,
      routes: [name],
      cause: '',
      effect: 'Significant delays',
      severity: grp.late.length >= 4 || maxMin >= 30 ? 1 : 0,
      location: nearestToCentroid(points),
      points,
      kind: 'delays',
    });
  }
  return out.sort((a, b) => b.points.length - a.points.length);
}
