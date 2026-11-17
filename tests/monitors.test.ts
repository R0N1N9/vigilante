import { describe, expect, it } from 'vitest';
import { cooledDown, crosses, dueForEscalation, matchAircraft, matchesKeywords, matchSignal, newMonitor, TEMPLATES, type MonitorHit } from '../src/lib/monitors';
import type { Signal } from '../src/lib/signals';

const sig = (p: Partial<Signal>): Signal => ({ id: 's1', source: 'news', kind: 'story', title: '', detail: '', severity: 2, at: 0, location: [-104.99, 39.74], packId: 'denver', ...p });

describe('keyword monitors', () => {
  it('matches whole words and phrases, case-insensitively', () => {
    expect(matchesKeywords('Police respond to SHOTS FIRED near Colfax', ['shots fired'])).toBe('shots fired');
    expect(matchesKeywords('Shootings down this year', ['shooting'])).toBeNull();
    expect(matchesKeywords('Fire at 1200 Main St.', ['main st'])).toBe('main st');
    expect(matchesKeywords('anything', ['', '  '])).toBeNull();
  });
  it('respects sources and minimum severity', () => {
    const m = newMonitor('keyword', { keywords: ['stabbing'], sources: ['news'], minSeverity: 2 });
    expect(matchSignal(m, sig({ title: 'Stabbing reported downtown' }))).toContain('stabbing');
    expect(matchSignal(m, sig({ title: 'Stabbing reported downtown', source: 'traffic' }))).toBeNull();
    expect(matchSignal(m, sig({ title: 'Stabbing reported downtown', severity: 1 }))).toBeNull();
    expect(matchSignal({ ...m, enabled: false }, sig({ title: 'Stabbing' }))).toBeNull();
  });
});

describe('proximity monitors', () => {
  it('fires inside the radius only', () => {
    const m = newMonitor('proximity', { name: 'HQ', center: [-104.99, 39.74], radiusM: 500 });
    expect(matchSignal(m, sig({ location: [-104.9905, 39.7402] }))).toMatch(/ft from HQ/);
    expect(matchSignal(m, sig({ location: [-104.9, 39.74] }))).toBeNull();
    expect(matchSignal(m, sig({ location: null }))).toBeNull();
  });
});

describe('aircraft watchlists', () => {
  const a = { hex: 'a1b2c3', callsign: 'HAWK1', reg: 'N911PD', type: 'AS50', kind: 'heli', military: false, emergency: null };
  it('matches prefixes, hex, types and classes', () => {
    expect(matchAircraft(newMonitor('aircraft', { aircraft: ['n911'] }), a)).toBe('n911');
    expect(matchAircraft(newMonitor('aircraft', { aircraft: ['A1B2C3'] }), a)).toBe('A1B2C3');
    expect(matchAircraft(newMonitor('aircraft', { aircraft: ['type:as50'] }), a)).toBe('type:as50');
    expect(matchAircraft(newMonitor('aircraft', { aircraft: ['type:heli'] }), a)).toBe('type:heli');
    expect(matchAircraft(newMonitor('aircraft', { aircraft: ['type:military', 'UAL'] }), a)).toBeNull();
  });
});

describe('thresholds, cooldown and escalation', () => {
  it('crosses above/below', () => {
    const m = newMonitor('threshold', { op: 'below', value: 60 });
    expect(crosses(m, 55)).toBe(true);
    expect(crosses(m, 60)).toBe(false);
    expect(crosses({ ...m, op: 'above' }, 61)).toBe(true);
    expect(crosses(m, null)).toBe(false);
  });
  it('cooldown', () => {
    expect(cooledDown(undefined, 0, 30)).toBe(true);
    expect(cooledDown(0, 29 * 60_000, 30)).toBe(false);
    expect(cooledDown(0, 30 * 60_000, 30)).toBe(true);
  });
  it('re-sends unacknowledged hits on schedule', () => {
    const m = newMonitor('keyword', { escalateMin: 5 });
    const hit: MonitorHit = { id: 'h', monitorId: m.id, monitorName: 'x', at: 0, title: '', detail: '', severity: 3, location: null, acked: false, escalations: 0 };
    expect(dueForEscalation([hit], [m], 4 * 60_000)).toHaveLength(0);
    expect(dueForEscalation([hit], [m], 5 * 60_000)).toHaveLength(1);
    expect(dueForEscalation([{ ...hit, escalations: 1 }], [m], 6 * 60_000)).toHaveLength(0);
    expect(dueForEscalation([{ ...hit, acked: true }], [m], 60 * 60_000)).toHaveLength(0);
  });
  it('templates build valid monitors', () => {
    for (const t of TEMPLATES) expect(t.make().id).toBeTruthy();
  });
});
