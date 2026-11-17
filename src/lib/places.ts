import { distanceM, type LonLat } from './geo';
import type { Place } from './packs';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PlaceMatch {
  place: Place;
  index: number;
}

/**
 * Find local places named in a piece of text. Longest names win so
 * "Downtown Denver" beats "Denver". Ambiguous names (e.g. "Golden", "Parker")
 * only count when another, unambiguous local place is also named.
 */
export function matchPlaces(text: string, places: Place[]): PlaceMatch[] {
  const sorted = [...places].sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const hits: PlaceMatch[] = [];
  for (const place of sorted) {
    const re = new RegExp(`(^|[^A-Za-z])(${escape(place.name)})(?![A-Za-z])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      const end = start + place.name.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ place, index: start });
      break;
    }
  }
  const hasSolid = hits.some((h) => !h.place.ambiguous);
  return hits.filter((h) => hasSolid || !h.place.ambiguous).sort((a, b) => a.index - b.index);
}

/** Nearest named place to a point, for human-friendly descriptions ("near Five Points"). */
export function nearestPlace(at: LonLat, places: Place[], maxM = 6000): { place: Place; distM: number } | null {
  let best: { place: Place; distM: number } | null = null;
  for (const p of places) {
    const d = distanceM(at, p.at);
    if (d <= maxM && (!best || d < best.distM)) best = { place: p, distM: d };
  }
  return best;
}

export function describeLocation(at: LonLat | null, places: Place[]): string {
  if (!at) return '';
  const n = nearestPlace(at, places);
  if (!n) return '';
  return n.distM < 1200 ? `in ${n.place.name}` : `near ${n.place.name}`;
}
