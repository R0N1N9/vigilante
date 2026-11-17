import { describe, expect, it } from 'vitest';
import { destination, type LonLat } from '../src/lib/geo';
import { detectOrbit, type TrailPoint } from '../src/lib/orbit';

const center: LonLat = [-104.99, 39.74];
const now = 1_000_000_000;

/** Points every 5 s around a circle; heading is tangent to the circle. */
function circle(radiusM: number, turns: number, secondsPerTurn = 120, clockwise = true): TrailPoint[] {
  const n = Math.round((turns * secondsPerTurn) / 5);
  return Array.from({ length: n + 1 }, (_, i) => {
    const ang = ((clockwise ? 1 : -1) * (i * 5 * 360)) / secondsPerTurn;
    const [lon, lat] = destination(center, radiusM, ang);
    return { lon, lat, t: now - (n - i) * 5000, track: (((ang + (clockwise ? 90 : -90)) % 360) + 360) % 360, alt: 1500 };
  });
}

describe('detectOrbit', () => {
  it('flags a helicopter circling at 1 km', () => {
    const r = detectOrbit(circle(1000, 1.5), now);
    expect(r.orbiting).toBe(true);
    expect(r.turns).toBeGreaterThan(1.3);
    expect(r.radiusM).toBeLessThan(1500);
  });

  it('works counter-clockwise too', () => {
    expect(detectOrbit(circle(800, 1.2, 120, false), now).orbiting).toBe(true);
  });

  it('ignores a straight line', () => {
    const pts: TrailPoint[] = Array.from({ length: 40 }, (_, i) => {
      const [lon, lat] = destination(center, i * 300, 45);
      return { lon, lat, t: now - (40 - i) * 5000, track: 45, alt: 3000 };
    });
    expect(detectOrbit(pts, now).orbiting).toBe(false);
  });

  it('ignores a wide circle (e.g. an airport pattern far larger than the limit)', () => {
    expect(detectOrbit(circle(9000, 1.5, 400), now).orbiting).toBe(false);
  });

  it('needs most of a full turn', () => {
    expect(detectOrbit(circle(1000, 0.6), now).orbiting).toBe(false);
  });

  it('ignores points older than the window', () => {
    const old = circle(1000, 2).map((p) => ({ ...p, t: p.t - 30 * 60_000 }));
    expect(detectOrbit(old, now).orbiting).toBe(false);
  });

  it('derives headings from movement when track is missing', () => {
    const pts = circle(1000, 1.5).map((p) => ({ ...p, track: null }));
    expect(detectOrbit(pts, now).orbiting).toBe(true);
  });
});
