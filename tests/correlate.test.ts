import { describe, expect, it } from 'vitest';
import { correlate } from '../src/lib/correlate';
import type { Signal } from '../src/lib/signals';

const now = 1_800_000_000_000;
const s = (id: string, source: Signal['source'], at: number, loc: [number, number] | null, severity: Signal['severity'] = 2): Signal => ({
  id, source, kind: 'x', title: id, detail: '', severity, at, location: loc, packId: 'atlanta',
});

describe('correlate', () => {
  it('groups nearby signals from different sources into one incident', () => {
    const c = correlate([
      s('orbit', 'adsb', now - 20 * 60_000, [-84.349, 33.764], 3),
      s('crash', 'traffic', now - 15 * 60_000, [-84.352, 33.766]),
      s('story', 'news', now - 5 * 60_000, [-84.349, 33.764], 1),
      s('far', 'traffic', now - 10 * 60_000, [-84.20, 33.90]),
    ], now);
    expect(c).toHaveLength(1);
    expect(c[0].sources.sort()).toEqual(['adsb', 'news', 'traffic']);
    expect(c[0].severity).toBe(4); // max 3, +1 for three sources
    expect(c[0].title).toBe('orbit');
  });

  it('needs two different sources', () => {
    expect(correlate([s('a', 'news', now - 1000, [-84.35, 33.76]), s('b', 'news', now - 2000, [-84.35, 33.76])], now)).toHaveLength(0);
  });

  it('does not join signals hours apart', () => {
    expect(correlate([s('a', 'adsb', now - 170 * 60_000, [-84.35, 33.76]), s('b', 'traffic', now - 10 * 60_000, [-84.35, 33.76])], now)).toHaveLength(0);
  });

  it('skips signals without a location', () => {
    expect(correlate([s('a', 'nws', now, null), s('b', 'traffic', now, [-84.35, 33.76])], now)).toHaveLength(0);
  });
});
