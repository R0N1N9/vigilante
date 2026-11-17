import denver from '../../packs/denver.json';
import atlanta from '../../packs/atlanta.json';
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
  /** True for locations the user searched for (vs. the built-in city packs). */
  custom?: boolean;
  /** Outage counts come from DOE ODIN by state; utilities link to their own official outage maps. */
  power: { state: string; utilities: { name: string; url: string }[] };
}

export const PACKS: CityPack[] = [denver as unknown as CityPack, atlanta as unknown as CityPack];

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
