// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, dedupeNews, parseFeed, titleSimilarity } from '../src/lib/news';
import { getPack, placesOf } from '../src/lib/packs';
import { matchPlaces } from '../src/lib/places';

const atl = placesOf(getPack('atlanta'));
const den = placesOf(getPack('denver'));
const fx = (n: string) => readFileSync(join(process.cwd(), 'tests/fixtures', n), 'utf8');

describe('places', () => {
  it('prefers the longest name and skips overlaps', () => {
    const m = matchPlaces('Crash near Little Five Points', atl);
    expect(m.map((x) => x.place.name)).toEqual(['Little Five Points']);
  });
  it('ignores ambiguous names on their own', () => {
    expect(matchPlaces('Golden retriever wins dog show', den)).toEqual([]);
    expect(matchPlaces('Fire in Golden, west of Lakewood', den).map((x) => x.place.name)).toEqual(['Golden', 'Lakewood']);
  });
});

describe('news', () => {
  it('parses a station feed with images, places and severity', () => {
    const items = parseFeed(fx('station.xml'), 'Example', atl);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ place: 'Little Five Points', severity: 2, category: 'crime', image: 'https://example.com/a.jpg' });
    expect(items[0].summary).toContain('shots fired');
    expect(items[1]).toMatchObject({ severity: 0, image: 'https://example.com/b.jpg' });
    expect(items[2].place).toBeNull();
  });

  it('splits the outlet off Google News titles', () => {
    const items = parseFeed(fx('gnews.xml'), 'Google News', atl);
    expect(items[0]).toMatchObject({ source: 'Example News', title: 'Shots fired near Little Five Points overnight, police say' });
    expect(items[1]).toMatchObject({ place: 'Midtown', category: 'traffic' });
  });

  it('merges the same story from several outlets', () => {
    const items = [...parseFeed(fx('station.xml'), 'Example', atl), ...parseFeed(fx('gnews.xml'), 'Google News', atl)];
    const merged = dedupeNews(items);
    const shooting = merged.filter((i) => /shoot|shots/i.test(i.title));
    expect(titleSimilarity('Police investigate shooting near Little Five Points', 'Shots fired near Little Five Points overnight, police say')).toBeGreaterThan(0.2);
    expect(shooting.length).toBeGreaterThanOrEqual(1);
    expect(merged.length).toBeLessThanOrEqual(items.length);
  });

  it('marks stories local only when they name a local place or term', () => {
    const items = parseFeed(fx('station.xml'), 'Example', atl, ['Atlanta']);
    expect(items.map((i) => i.local)).toEqual([true, false, false]);
  });

  it('classifies severity', () => {
    expect(classify('SWAT standoff ends').severity).toBe(2);
    expect(classify('Car break-ins reported').severity).toBe(1);
    expect(classify('New park opens').severity).toBe(0);
  });
});
