import { describe, expect, it } from 'vitest';
import type { WatchArea } from '../src/lib/areas';
import { pointInPolygon } from '../src/lib/areas';
import { DEFAULT_PUSH, inQuietHours, shouldPush } from '../src/lib/rules';

const square: [number, number][] = [[-84.36, 33.75], [-84.34, 33.75], [-84.34, 33.77], [-84.36, 33.77]];
const area: WatchArea = { id: 'a', name: 'Home', packId: 'atlanta', polygon: square, alerts: true, color: '#fff' };
const on = { ...DEFAULT_PUSH, enabled: true, topic: 't', quietStart: '', quietEnd: '' };
const noon = Date.UTC(2026, 10, 17, 17, 0); // 12:00 in Atlanta

describe('watch areas', () => {
  it('point in polygon', () => {
    expect(pointInPolygon([-84.35, 33.76], square)).toBe(true);
    expect(pointInPolygon([-84.30, 33.76], square)).toBe(false);
  });
});

describe('quiet hours', () => {
  it('handles windows across midnight', () => {
    expect(inQuietHours(23 * 60, '22:30', '06:30')).toBe(true);
    expect(inQuietHours(5 * 60, '22:30', '06:30')).toBe(true);
    expect(inQuietHours(12 * 60, '22:30', '06:30')).toBe(false);
    expect(inQuietHours(12 * 60, '', '')).toBe(false);
  });
});

describe('shouldPush', () => {
  it('respects the severity threshold, boosted inside a watch area', () => {
    expect(shouldPush({ severity: 2, location: [-84.30, 33.76] }, on, [area], noon, 'America/New_York').push).toBe(false);
    const inside = shouldPush({ severity: 2, location: [-84.35, 33.76] }, on, [area], noon, 'America/New_York');
    expect(inside.push).toBe(true);
    expect(inside.areaNames).toEqual(['Home']);
  });

  it('can be limited to watch areas', () => {
    const s = { ...on, onlyWatchAreas: true, minSeverity: 1 as const };
    expect(shouldPush({ severity: 4, location: [-84.30, 33.76] }, s, [area], noon, 'America/New_York').reason).toBe('outside watch areas');
    expect(shouldPush({ severity: 3, location: null, regional: true }, s, [area], noon, 'America/New_York').push).toBe(true);
  });

  it('holds back non-critical alerts in quiet hours', () => {
    const s = { ...on, quietStart: '22:30', quietEnd: '06:30' };
    const night = Date.UTC(2026, 10, 18, 4, 0); // 23:00 Atlanta
    expect(shouldPush({ severity: 3, location: null }, s, [], night, 'America/New_York').reason).toBe('quiet hours');
    expect(shouldPush({ severity: 4, location: null }, s, [], night, 'America/New_York').push).toBe(true);
  });

  it('does nothing when disabled', () => {
    expect(shouldPush({ severity: 4, location: null }, DEFAULT_PUSH, [], noon, 'UTC').push).toBe(false);
  });
});
