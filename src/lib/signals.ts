import type { LonLat } from './geo';

export type SignalSource = 'adsb' | 'nws' | 'traffic' | 'news' | 'tfr' | 'drone' | 'transit' | 'power' | 'fire' | 'crime' | 'quake' | 'flood' | 'storm' | 'air' | 'hotspot' | 'fbi';
export type Severity = 0 | 1 | 2 | 3 | 4;

/**
 * One observation from any source, in a common shape. Signals feed the
 * correlation engine (developing incidents), phone alerts and the brief.
 */
export interface Signal {
  id: string; // stable per real-world thing, e.g. "adsb:orbit:a1b2c3"
  source: SignalSource;
  kind: string; // e.g. "orbit", "squawk", "heli", "closure", "story", "tfr", "drone"
  title: string;
  detail: string;
  severity: Severity;
  at: number; // epoch ms
  location: LonLat | null;
  url?: string;
  packId: string;
}

export const SOURCE_LABEL: Record<SignalSource, string> = {
  adsb: 'Aircraft',
  nws: 'Weather',
  traffic: 'Traffic',
  news: 'News',
  tfr: 'No-fly zone',
  drone: 'Drone',
  transit: 'Transit',
  power: 'Power',
  fire: 'Fire',
  crime: 'Crime',
  quake: 'Earthquake',
  flood: 'Flood',
  storm: 'Storm report',
  air: 'Air quality',
  hotspot: 'Satellite fire',
  fbi: 'FBI poster',
};
