import denver from '../../packs/denver.json';
import atlanta from '../../packs/atlanta.json';
import type { LonLat } from './geo';

export interface RadioFeed {
  name: string;
  url: string;
  agency: string;
}

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
  traffic: { provider: 'ga511' | 'cotrip' };
  /** localTerms: city/county names that mark a story as local even without a neighborhood. */
  news: { feeds: NewsFeed[]; googleQuery: string; localTerms: string[] };
  liveTv: LiveTv[];
  places: PlaceTuple[];
}

export const PACKS: CityPack[] = [denver as unknown as CityPack, atlanta as unknown as CityPack];

export function getPack(id: string): CityPack {
  return PACKS.find((p) => p.id === id) ?? PACKS[0];
}

export function placesOf(pack: CityPack): Place[] {
  return pack.places.map(([name, lon, lat, amb]) => ({ name, at: [lon, lat], ambiguous: amb === 1 }));
}
