import type { LonLat } from './geo';
import type { Severity } from './signals';
import { nearArea } from './tfr';

/** County-level outage counts from DOE's ODIN (Oak Ridge National Laboratory), published as open data. */
export interface CountyOutage {
  id: string; // state + county
  county: string;
  state: string;
  customers: number;
  utilities: string[];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  severity: Severity;
}

export const odinUrl = (state: string) =>
  `https://ornl.opendatasoft.com/api/explore/v2.1/catalog/datasets/odin-real-time-outages-county/records?where=${encodeURIComponent(`state="${state}"`)}&limit=100`;

interface OdinRecord {
  name?: string;
  county?: string;
  state?: string;
  metersaffected?: number;
  geom?: { geometry?: GeoJSON.Geometry } | GeoJSON.Geometry;
}

export function outageSeverity(customers: number): Severity {
  return customers >= 10_000 ? 3 : customers >= 1_000 ? 2 : customers >= 100 ? 1 : 0;
}

const utilityName = (n = '') => n.replace(/,\d+$/, '').replace(/\b(INC|ASSN|CO|CORP|LLC)\b\.?/g, '').replace(/\s+,/g, ',').replace(/[,\s]+$/, '').trim();

export function parseOdin(data: { results?: OdinRecord[] }, center: LonLat, radiusNm: number): CountyOutage[] {
  const byCounty = new Map<string, CountyOutage>();
  for (const r of data.results ?? []) {
    const geom = (r.geom && 'geometry' in r.geom ? r.geom.geometry : (r.geom as GeoJSON.Geometry | undefined)) ?? null;
    const poly = geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon') ? geom : null;
    if (poly && !nearArea(poly, center, radiusNm)) continue;
    if (!poly) continue;
    const id = `${r.state}:${r.county}`;
    const c = byCounty.get(id) ?? { id, county: r.county ?? '?', state: r.state ?? '', customers: 0, utilities: [], geometry: poly, severity: 0 as Severity };
    c.customers += r.metersaffected ?? 0;
    const u = utilityName(r.name);
    if (u && !c.utilities.includes(u)) c.utilities.push(u);
    byCounty.set(id, c);
  }
  return [...byCounty.values()].map((c) => ({ ...c, severity: outageSeverity(c.customers) })).sort((a, b) => b.customers - a.customers);
}
