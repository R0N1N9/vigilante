import { distanceM, NM_TO_M, type LonLat } from './geo';

export interface Tfr {
  id: string; // NOTAM id, e.g. "6/8034"
  type: string; // SECURITY, HAZARDS, SPACE OPERATIONS, ...
  title: string;
  description: string;
  modified: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  url: string;
}

export const TFR_WFS_URL =
  'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=500&outputFormat=application/json&srsname=EPSG:4326';
export const TFR_LIST_URL = 'https://tfr.faa.gov/tfrapi/exportTfrList';

interface WfsFeature {
  geometry: GeoJSON.Geometry | null;
  properties: { NOTAM_KEY?: string; TITLE?: string; LEGAL?: string; LAST_MODIFICATION_DATETIME?: string };
}

interface ListEntry {
  notam_id: string;
  type?: string;
  description?: string;
}

function rings(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
}

/** True if any vertex lies within the radius, or the area's center lies inside the shape's bbox. */
export function nearArea(g: GeoJSON.Polygon | GeoJSON.MultiPolygon, center: LonLat, radiusNm: number): boolean {
  const r = radiusNm * NM_TO_M;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings(g)) {
    for (const [x, y] of ring) {
      if (distanceM(center, [x, y]) <= r) return true;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return center[0] >= minX && center[0] <= maxX && center[1] >= minY && center[1] <= maxY;
}

/** Join the FAA geometry layer with the TFR list and keep the ones touching the area. */
export function parseTfrs(wfs: { features: WfsFeature[] }, list: ListEntry[], center: LonLat, radiusNm: number): Tfr[] {
  const byId = new Map(list.map((e) => [e.notam_id, e]));
  const out = new Map<string, Tfr>();
  for (const f of wfs.features ?? []) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    if (!nearArea(g, center, radiusNm)) continue;
    const id = (f.properties.NOTAM_KEY ?? '').split('-')[0];
    if (!id) continue;
    const entry = byId.get(id);
    const prev = out.get(id);
    if (prev) {
      // Several shapes for one NOTAM: merge into a MultiPolygon.
      const coords = [...(prev.geometry.type === 'Polygon' ? [prev.geometry.coordinates] : prev.geometry.coordinates), ...(g.type === 'Polygon' ? [g.coordinates] : g.coordinates)];
      prev.geometry = { type: 'MultiPolygon', coordinates: coords };
      continue;
    }
    out.set(id, {
      id,
      type: entry?.type ?? f.properties.LEGAL ?? 'TFR',
      title: f.properties.TITLE ?? entry?.description ?? id,
      description: entry?.description ?? f.properties.TITLE ?? '',
      modified: f.properties.LAST_MODIFICATION_DATETIME ?? '',
      geometry: g,
      url: `https://tfr.faa.gov/tfr3/?page=detail_${id.replace('/', '_')}`,
    });
  }
  return [...out.values()];
}
