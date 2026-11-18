import { describe, expect, it } from 'vitest';
import { hasLocalSources, nearestPack, packForTimezone, PACKS } from '../src/lib/packs';

describe('built-in cities', () => {
  it('has the largest city of every state, all well-formed', () => {
    const ids = new Set(PACKS.map((p) => p.id));
    expect(ids.size).toBe(PACKS.length);
    expect(PACKS.length).toBeGreaterThanOrEqual(60);
    const states = new Set(PACKS.map((p) => p.power.state));
    expect(states.size).toBe(51); // 50 states + DC
    for (const p of PACKS) {
      expect(p.nwsOffice, p.id).toMatch(/^[A-Z]{3}$/);
      expect(p.timezone, p.id).toMatch(/^(America|Pacific)\//);
      expect(Math.abs(p.center[1]), p.id).toBeLessThan(72);
      expect(p.center[0], p.id).toBeLessThan(-60);
      expect(p.intel.airports.length, p.id).toBeGreaterThan(0);
    }
    for (const id of ['new-york', 'atlanta', 'nashville', 'houston', 'denver', 'salt-lake-city', 'los-angeles', 'san-francisco', 'portland', 'seattle', 'phoenix', 'las-vegas', 'st-louis', 'columbus', 'detroit', 'chicago', 'huntsville', 'birmingham']) expect(ids.has(id), id).toBe(true);
  });
  it('picks the nearest city, or one in the time zone', () => {
    expect(nearestPack([-87.65, 41.9]).id).toBe('chicago');
    expect(nearestPack([-104.98, 39.74]).id).toBe('denver');
    expect(nearestPack([-96.8, 32.78]).id).toBe('dallas');
    expect(nearestPack([-118.5, 34.0]).id).toBe('los-angeles');
    expect(packForTimezone('America/New_York').id).toBe('new-york');
    expect(packForTimezone('America/Chicago').id).toBe('chicago');
    expect(packForTimezone('Europe/Paris').id).toBe('denver');
  });
  it('marks only hand-built cities as having full local sources', () => {
    expect(PACKS.filter(hasLocalSources).map((p) => p.id).sort()).toEqual(['atlanta', 'chicago', 'dallas', 'denver', 'new-york', 'san-francisco', 'seattle']);
  });
});
