export type LonLat = [number, number];

const EARTH_R_M = 6_371_000;
export const NM_TO_M = 1852;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters. */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees 0..360. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const p1 = toRad(a[1]);
  const p2 = toRad(b[1]);
  const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at a distance and bearing from an origin. */
export function destination(origin: LonLat, distM: number, brgDeg: number): LonLat {
  const d = distM / EARTH_R_M;
  const b = toRad(brgDeg);
  const p1 = toRad(origin[1]);
  const l1 = toRad(origin[0]);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((toDeg(l2) + 540) % 360) - 180, toDeg(p2)];
}

/** Closed ring approximating a circle, for drawing the area of interest. */
export function circleRing(center: LonLat, radiusM: number, steps = 96): LonLat[] {
  const ring: LonLat[] = [];
  for (let i = 0; i <= steps; i++) ring.push(destination(center, radiusM, (i * 360) / steps));
  return ring;
}

/** Signed smallest difference b - a in degrees, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
