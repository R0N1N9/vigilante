import { describe, expect, it } from 'vitest';
import type { Crime } from '../src/lib/intel';
import { ruleInsights } from '../src/lib/insights';
import { computeStability, levelFor, rateNeighborhoods, type StabilityInputs } from '../src/lib/stability';

const now = Date.UTC(2026, 10, 17, 18);
const crime = (daysAgo: number, severity: 0 | 1 | 2 | 3, hood = 'Five Points'): Crime => ({ id: Math.random().toString(), offense: 'x', category: 'x', at: now - daysAgo * 86_400_000, location: [-104.98, 39.75], address: '', neighborhood: hood, firearm: severity === 3, severity });
const base: StabilityInputs = { now, crimes: [], clusters: [], incidents: [], nwsMaxSeverity: 0, storms: [], quakes: [], gauges: [], air: null, wildfiresNear: 0, hotspotsUnexplained: 0, outageCustomers: 0, transitSerious: 0, roadSerious: 0, airportDelays: [], orbits: 0, squawks: 0 };

describe('stability index', () => {
  it('is 100 and Stable when nothing is happening', () => {
    const s = computeStability(base);
    expect(s).toMatchObject({ score: 100, level: 'Stable' });
  });

  it('a city with a steady gunfire rate is not penalized for its baseline', () => {
    const steady = Array.from({ length: 21 }, (_, k) => crime(k / 3, 3)); // 3/day all week
    expect(computeStability({ ...base, crimes: steady }).components[0].risk).toBeLessThan(25);
  });

  it('satellite noise cannot dominate the index', () => {
    expect(computeStability({ ...base, hotspotsUnexplained: 89 }).score).toBeGreaterThanOrEqual(80);
  });

  it('a normal week of crime does not lower the score; a spike does', () => {
    const steady = Array.from({ length: 14 }, (_, k) => crime(k / 2, 2)); // 2/day spread over 7 days
    expect(computeStability({ ...base, crimes: steady }).components[0].risk).toBeLessThan(20);
    const spike = [...steady, ...Array.from({ length: 10 }, () => crime(0.5, 3))];
    const s = computeStability({ ...base, crimes: spike });
    expect(s.components[0].risk).toBeGreaterThan(50);
    expect(s.score).toBeLessThan(90);
  });

  it('weights hazards, incidents and infrastructure', () => {
    const s = computeStability({ ...base, nwsMaxSeverity: 4, squawks: 1, orbits: 2, outageCustomers: 20_000, air: { aqi: 180, pm25: 90, ozone: 10, at: now, label: 'Unhealthy' } });
    expect(s.score).toBeLessThan(70);
    expect(['Guarded', 'Elevated', 'High']).toContain(s.level);
  });

  it('levels', () => {
    expect([95, 70, 50, 30, 10].map(levelFor)).toEqual(['Stable', 'Guarded', 'Elevated', 'High', 'Severe']);
  });

  it('rates neighborhoods relative to the busiest', () => {
    const r = rateNeighborhoods([crime(1, 3, 'A'), crime(1, 2, 'A'), crime(1, 1, 'B'), crime(2, 0, 'C')]);
    expect(r[0]).toMatchObject({ name: 'A', crimes: 2, violent: 2, score: 30 });
    expect(r.at(-1)!.name).toBe('C');
  });
});

describe('rule insights', () => {
  it('leads with the index and explains the crime trend', () => {
    const crimes = [...Array.from({ length: 14 }, (_, k) => crime(k / 2, 2)), ...Array.from({ length: 8 }, () => crime(0.2, 2, 'Capitol Hill'))];
    const stability = computeStability({ ...base, crimes });
    const ins = ruleInsights({ stability, crimes, tz: 'America/Denver', orbits: [{ label: 'N123 (EC35)' }], alerts: [], hotspots: 0, hotspotsUnexplained: 1, quakes: [], air: null, transitSerious: [], outageCustomers: 0, news: [] });
    expect(ins[0].text).toMatch(/^Stability \d+\/100/);
    expect(ins.some((x) => /above this week's average/.test(x.text))).toBe(true);
    expect(ins.some((x) => /circling now/.test(x.text))).toBe(true);
    expect(ins.some((x) => /no known wildfire/.test(x.text))).toBe(true);
  });
});
