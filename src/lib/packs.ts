import denver from '../../packs/denver.json';
import atlanta from '../../packs/atlanta.json';

export interface RadioFeed {
  name: string;
  url: string;
  agency: string;
}

/** A city pack: everything the console needs to watch one area. */
export interface CityPack {
  id: string;
  name: string;
  region: string;
  timezone: string;
  center: [number, number]; // [lon, lat]
  zoom: number;
  radiusNm: number;
  fieldElevationFt: number;
  nwsOffice: string;
  radioFeeds: RadioFeed[];
  notes: string;
}

export const PACKS: CityPack[] = [denver as CityPack, atlanta as CityPack];

export function getPack(id: string): CityPack {
  return PACKS.find((p) => p.id === id) ?? PACKS[0];
}
