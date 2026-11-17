import type { LonLat } from './geo';

export interface WatchArea {
  id: string;
  name: string;
  packId: string;
  polygon: LonLat[]; // open ring (first point not repeated)
  alerts: boolean; // push phone alerts for things inside this area
  color: string;
}

/** Ray-casting point-in-polygon on lon/lat (fine at neighborhood scale). */
export function pointInPolygon(p: LonLat, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function areasContaining(p: LonLat | null, areas: WatchArea[]): WatchArea[] {
  if (!p) return [];
  return areas.filter((a) => a.polygon.length >= 3 && pointInPolygon(p, a.polygon));
}

export function centroid(poly: LonLat[]): LonLat {
  const n = poly.length || 1;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

export const AREA_COLORS = ['#3DD6F5', '#A78BFA', '#2BD47D', '#F472B6', '#FFB020'];
