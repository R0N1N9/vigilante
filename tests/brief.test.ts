import { describe, expect, it } from 'vitest';
import { buildBrief } from '../src/lib/brief';
import { getPack, placesOf } from '../src/lib/packs';
import type { Signal } from '../src/lib/signals';

const t0 = Date.UTC(2026, 10, 17, 4, 0);
const sig = (p: Partial<Signal>): Signal => ({ id: Math.random().toString(), source: 'news', kind: 'x', title: '', detail: '', severity: 1, at: t0 + 3600_000, location: null, packId: 'atlanta', ...p });

describe('brief', () => {
  it('summarizes the window by section', () => {
    const b = buildBrief({
      packId: 'atlanta', packName: 'Atlanta', tz: 'America/New_York', from: t0, to: t0 + 8 * 3600_000, clusters: [],
      places: placesOf(getPack('atlanta')),
      history: [
        sig({ source: 'adsb', kind: 'orbit', title: 'Helicopter circling', detail: 'N123AB (EC35) · 2.1 turns', severity: 3, location: [-84.349, 33.764] }),
        sig({ source: 'adsb', kind: 'heli', title: 'Helicopter' }),
        sig({ source: 'traffic', kind: 'closure', title: 'Crash · I-85', severity: 2, location: [-84.383, 33.784] }),
        sig({ source: 'news', title: 'Shooting near Little Five Points', severity: 2 }),
        sig({ source: 'news', title: 'old', at: t0 - 1000 }),
        sig({ source: 'news', title: 'other city', packId: 'denver' }),
      ],
    });
    expect(b.headline).toContain('1 circling aircraft');
    expect(b.headline).toContain('1 road incident');
    expect(b.sections.map((s) => s.heading)).toEqual(['Air activity', 'Roads', 'In the news']);
    expect(b.sections[0].items.join(' ')).toContain('circled in Little Five Points');
    expect(b.sections[2].items).toHaveLength(1);
    expect(b.headline).toContain('1 local safety story');
  });

  it('says quiet when nothing happened', () => {
    const b = buildBrief({ packId: 'denver', packName: 'Denver', tz: 'America/Denver', from: t0, to: t0 + 1, clusters: [], places: [], history: [] });
    expect(b.headline).toBe('Denver: quiet. Nothing notable in this period.');
  });
});
