import { bearingDeg, distanceM, headingDelta, type LonLat } from './geo';

export interface TrailPoint {
  lon: number;
  lat: number;
  t: number; // epoch ms
  track: number | null; // degrees, from the transponder when available
  alt: number | null;
}

export interface OrbitResult {
  orbiting: boolean;
  turns: number; // completed 360° turns in the window
  center: LonLat;
  radiusM: number; // max distance of any point from the center
}

export interface OrbitOptions {
  windowMs: number;
  minTurnDeg: number;
  maxRadiusM: number;
  minPoints: number;
}

export const DEFAULT_ORBIT: OrbitOptions = {
  windowMs: 10 * 60_000,
  minTurnDeg: 330, // a near-complete circle counts
  maxRadiusM: 4_000,
  minPoints: 8,
};

/**
 * Detect an aircraft circling one spot: the classic sign of a police, news or
 * medical helicopter working an incident. Sums the signed heading change over
 * recent trail points and checks that the track stays within a small radius.
 */
export function detectOrbit(trail: TrailPoint[], now: number, opts: OrbitOptions = DEFAULT_ORBIT): OrbitResult {
  const pts = trail.filter((p) => now - p.t <= opts.windowMs);
  const none: OrbitResult = { orbiting: false, turns: 0, center: [0, 0], radiusM: 0 };
  if (pts.length < opts.minPoints) return none;

  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const center: LonLat = [lon, lat];
  const radiusM = Math.max(...pts.map((p) => distanceM(center, [p.lon, p.lat])));

  // Headings: prefer the reported track, otherwise derive from movement.
  const headings: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.track != null) headings.push(p.track);
    else if (i > 0) {
      const prev = pts[i - 1];
      if (distanceM([prev.lon, prev.lat], [p.lon, p.lat]) > 20) headings.push(bearingDeg([prev.lon, prev.lat], [p.lon, p.lat]));
    }
  }

  let sum = 0;
  for (let i = 1; i < headings.length; i++) {
    const d = headingDelta(headings[i - 1], headings[i]);
    if (Math.abs(d) <= 120) sum += d; // ignore implausible jumps (bad samples)
  }

  const turned = Math.abs(sum);
  const orbiting = turned >= opts.minTurnDeg && radiusM <= opts.maxRadiusM;
  return { orbiting, turns: turned / 360, center, radiusM };
}
