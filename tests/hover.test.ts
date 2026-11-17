import { describe, expect, it } from 'vitest';
import { hoverHtml, HOVERABLE } from '../src/map/popups';
import { getState } from '../src/data/store';
import { rateNeighborhoods } from '../src/lib/stability';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

describe('map hover tooltips', () => {
  const base = getState();
  it('describes a crime report and escapes text', () => {
    const s = { ...base, crimes: [{ id: 'c1', offense: 'Robbery <street>', category: 'violent', at: Date.now() - 3_600_000, location: [-105, 39.7] as [number, number], address: '100 Main St', neighborhood: 'Five Points', firearm: true, severity: 3 as const }] };
    const html = hoverHtml('crime-pts', { id: 'c1' }, s, esc)!;
    expect(html).toContain('CRIME REPORT');
    expect(html).toContain('Robbery &lt;street&gt; · firearm');
    expect(html).toContain('Five Points');
  });
  it('covers every hoverable layer without throwing', () => {
    for (const l of HOVERABLE) expect(() => hoverHtml(l, { id: 'x', hex: 'x', name: 'Area' }, base, esc, 'Feed')).not.toThrow();
    expect(hoverHtml('areas-fill', { name: 'Home' }, base, esc)).toContain('WATCH AREA');
    expect(hoverHtml('radio-fill', {}, base, esc, 'Denver Fire')).toContain('Click to listen');
    expect(hoverHtml('news-clusters', { point_count: 4 }, base, esc)).toContain('4 local stories');
  });
});

describe('neighborhood centers', () => {
  it('averages report positions', () => {
    const mk = (lon: number, lat: number) => ({ id: `${lon}`, offense: 'Theft', category: 'property', at: 0, location: [lon, lat] as [number, number], address: '', neighborhood: 'A', firearm: false, severity: 1 as const });
    const [a] = rateNeighborhoods([mk(-105, 39), mk(-104, 40)]);
    expect(a.center).toEqual([-104.5, 39.5]);
  });
});
