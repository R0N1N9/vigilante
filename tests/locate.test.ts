import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPack, nearestBuiltin } from '../src/lib/locate';
import { getPack, registerPacks } from '../src/lib/packs';

afterEach(() => vi.unstubAllGlobals());

describe('custom locations', () => {
  it('finds a built-in city pack nearby', () => {
    expect(nearestBuiltin([-105.27, 40.015])?.id).toBe('denver'); // Boulder, ~40 km
    expect(nearestBuiltin([-81.09, 32.08])).toBeNull(); // Savannah
  });

  it('inherits local sources near a built-in city, and works without NWS', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const p = await buildPack({ name: 'Boulder, CO', label: 'Boulder, Colorado', at: [-105.27, 40.015], state: 'Colorado', county: 'Boulder County' });
    expect(p).toMatchObject({ id: 'loc:40.015,-105.270', name: 'Boulder', region: 'CO', custom: true, traffic: { provider: 'cotrip' }, power: { state: 'Colorado' } });
    expect(p.transit?.agency).toBe('RTD');
    expect(p.news.localTerms[0][0]).toBe('Boulder');
  });

  it('falls back to national sources elsewhere', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const p = await buildPack({ name: 'Savannah, GA', label: 'Savannah, Georgia', at: [-81.09, 32.08], state: 'Georgia', county: 'Chatham County' });
    expect(p.transit).toBeNull();
    expect(p.traffic.provider).toBe('ga511');
    expect(p.news.feeds).toEqual([]);
    expect(p.news.googleQuery).toContain('"Savannah" GA');
    registerPacks([p]);
    expect(getPack(p.id).name).toBe('Savannah');
    expect(getPack('nope').id).toBe('denver');
  });
});
