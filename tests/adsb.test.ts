import { describe, expect, it } from 'vitest';
import { normalizeAircraft, passesCeiling, type RawAircraft } from '../src/lib/adsb';
import type { LonLat } from '../src/lib/geo';

const denver: LonLat = [-104.9903, 39.7392];
const base: RawAircraft = { hex: 'a00f3d', flight: 'N1025V  ', r: 'N1025V', t: 'C172', alt_baro: 10500, gs: 115, track: 7, squawk: '1200', category: 'A1', lat: 39.93, lon: -105.24, seen_pos: 0.3 };
const norm = (r: Partial<RawAircraft>) => normalizeAircraft({ ...base, ...r }, denver, 5280)!;

describe('normalizeAircraft', () => {
  it('trims callsign and computes AGL and distance', () => {
    const a = norm({});
    expect(a.callsign).toBe('N1025V');
    expect(a.aglFt).toBe(10500 - 5280);
    expect(a.distNm).toBeGreaterThan(10);
    expect(a.distNm).toBeLessThan(20);
    expect(a.cls).toBe('normal');
  });

  it('detects helicopters by category or type', () => {
    expect(norm({ category: 'A7', t: 'XXXX' }).kind).toBe('heli');
    expect(norm({ category: 'A1', t: 'EC35' }).kind).toBe('heli');
    expect(norm({}).kind).toBe('fixed');
  });

  it('flags emergency squawks above everything else', () => {
    const a = norm({ squawk: '7700', category: 'A7' });
    expect(a.cls).toBe('emergency');
    expect(a.emergency).toBe('General emergency');
  });

  it('flags military from dbFlags', () => {
    expect(norm({ dbFlags: 1 }).cls).toBe('military');
  });

  it('handles aircraft on the ground', () => {
    const a = norm({ alt_baro: 'ground' });
    expect(a.onGround).toBe(true);
    expect(a.aglFt).toBe(0);
  });

  it('drops records without a position', () => {
    expect(normalizeAircraft({ hex: 'x' }, denver, 5280)).toBeNull();
  });

  it('marks low aircraft', () => {
    expect(norm({ alt_baro: 7000 }).cls).toBe('low');
  });
});

describe('passesCeiling', () => {
  it('hides high aircraft but always keeps helicopters and emergencies', () => {
    expect(passesCeiling(norm({ alt_baro: 38000 }), 10000, true)).toBe(false);
    expect(passesCeiling(norm({ alt_baro: 38000, category: 'A7' }), 10000, true)).toBe(true);
    expect(passesCeiling(norm({ alt_baro: 38000, squawk: '7600' }), 10000, true)).toBe(true);
    expect(passesCeiling(norm({ alt_baro: 38000 }), null, true)).toBe(true);
  });

  it('optionally hides aircraft on the ground', () => {
    expect(passesCeiling(norm({ alt_baro: 'ground' }), null, true)).toBe(false);
    expect(passesCeiling(norm({ alt_baro: 'ground' }), null, false)).toBe(true);
  });
});
