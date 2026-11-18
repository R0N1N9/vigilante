import denver from '../../packs/denver.json';
import atlanta from '../../packs/atlanta.json';
import usCities from '../../packs/us-cities.json';
import type { LonLat } from './geo';

export interface RadioFeed {
  name: string;
  url: string; // Broadcastify web player or listing page (played in-app via Broadcastify's own player)
  agency: string;
  /** Approximate coverage as [lon, lat, radius km]; null for browse-only listings. */
  coverage: [number, number, number] | null;
}

/** [name, lon, lat]: a city or county name and its approximate center. */
export type TermTuple = [string, number, number];

export interface NewsFeed {
  name: string;
  url: string;
}

export interface LiveTv {
  name: string;
  channelId: string; // YouTube channel id
}

/** [name, lon, lat, ambiguous?]: ambiguous names only count when the story also names another local place. */
export type PlaceTuple = [string, number, number] | [string, number, number, number];

export interface Place {
  name: string;
  at: LonLat;
  ambiguous: boolean;
}

/** A city pack: everything the console needs to watch one area. */
export interface CityPack {
  id: string;
  name: string;
  region: string;
  timezone: string;
  center: LonLat;
  zoom: number;
  radiusNm: number;
  fieldElevationFt: number;
  nwsOffice: string;
  radioFeeds: RadioFeed[];
  notes: string;
  traffic: { provider: 'ga511' | 'cotrip' | 'none' };
  /** localTerms: city/county names that mark a story as local even without a neighborhood. */
  news: { feeds: NewsFeed[]; googleQuery: string; localTerms: TermTuple[] };
  liveTv: LiveTv[];
  places: PlaceTuple[];
  transit:
    | { agency: 'RTD'; alertsUrl: string; staticUrl: string; infoUrl: string }
    | { agency: 'MARTA'; tripUpdatesUrl: string; vehiclesUrl: string; staticUrl: string; infoUrl: string }
    | null;
  /** Keyless city/agency sources: crime and 311 providers, FBI field office, airports to watch. */
  intel: { crime: string | null; s311: 'denver' | null; fbiOffice: string | null; airports: string[] };
  /** True for locations the user searched for (vs. the built-in city packs). */
  custom?: boolean;
  /** Outage counts come from DOE ODIN by state; utilities link to their own official outage maps. */
  power: { state: string; utilities: { name: string; url: string }[] };
}

/** Denver and Atlanta have full local sources; the rest are the largest city in every state (plus a few more), with national sources. */
export const PACKS: CityPack[] = [denver as unknown as CityPack, atlanta as unknown as CityPack, ...(usCities as unknown as CityPack[])];

/** Cities with hand-built local sources (crime, 311, traffic, transit, local news, scanner feeds). */
export const hasLocalSources = (p: CityPack) => !!(p.intel.crime || p.transit || p.traffic.provider !== 'none' || p.news.feeds.length);

/** The built-in city nearest to a point (no distance limit). */
export function nearestPack(at: LonLat): CityPack {
  const d = (p: CityPack) => {
    const dLat = ((p.center[1] - at[1]) * Math.PI) / 180;
    const dLon = ((p.center[0] - at[0]) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((at[1] * Math.PI) / 180) * Math.cos((p.center[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(a));
  };
  return PACKS.reduce((best, p) => (d(p) < d(best) ? p : best), PACKS[0]);
}

/** Without a location: the first built-in city in this time zone (the list runs largest-first within a zone's states), else Denver. */
export function packForTimezone(tz: string): CityPack {
  const order = ['new-york', 'los-angeles', 'chicago', 'houston', 'phoenix', 'denver', 'anchorage', 'honolulu'];
  const inZone = PACKS.filter((p) => p.timezone === tz);
  return inZone.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99))[0] ?? PACKS[0];
}

/** Locations the user searched for or picked from device location. */
const custom = new Map<string, CityPack>();

export function registerPacks(list: CityPack[]) {
  custom.clear();
  list.forEach((p) => custom.set(p.id, p));
}

export function allPacks(): CityPack[] {
  return [...PACKS, ...custom.values()];
}

export function getPack(id: string): CityPack {
  return custom.get(id) ?? PACKS.find((p) => p.id === id) ?? PACKS[0];
}

export function placesOf(pack: CityPack): Place[] {
  return pack.places.map(([name, lon, lat, amb]) => ({ name, at: [lon, lat], ambiguous: amb === 1 }));
}
