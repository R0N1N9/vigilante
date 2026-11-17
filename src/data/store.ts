import { useSyncExternalStore } from 'react';
import type { Aircraft } from '../lib/adsb';
import type { WatchArea } from '../lib/areas';
import type { Brief } from '../lib/brief';
import type { Cluster } from '../lib/correlate';
import type { LonLat } from '../lib/geo';
import type { NewsItem } from '../lib/news';
import type { NwsAlert } from '../lib/nws';
import type { TrailPoint } from '../lib/orbit';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';
import type { CityPack } from '../lib/packs';
import type { Severity } from '../lib/signals';
import type { Tfr } from '../lib/tfr';
import type { Camera, TrafficEvent } from '../lib/traffic';
import type { TransitDisruption } from '../lib/transit';
import type { CountyOutage } from '../lib/outages';
import type { FireIncident } from '../lib/fires';
import type { AirportDelay, AirQuality, Crime, Gauge, Hotspot, Quake, ServiceRequest, Ship, StormReport, Wanted } from '../lib/intel';

export type Basemap = 'dark' | 'satellite';

export type FeedStatus = 'idle' | 'live' | 'stale' | 'error' | 'off';

export interface Incident {
  id: string;
  kind: 'orbit' | 'squawk' | 'weather' | 'tfr' | 'drone' | 'fire' | 'quake' | 'flood' | 'storm' | 'air' | 'airport' | 'hotspot';
  severity: Severity;
  title: string;
  detail: string;
  at: number;
  location: LonLat | null;
  hex?: string;
  alertId?: string;
  url?: string;
}

export interface LogEntry {
  id: string;
  at: number;
  severity: Severity;
  text: string;
}

export interface DroneTrack {
  id: string;
  uasId: string;
  uaType: number;
  location: LonLat | null;
  heightM: number | null;
  altGeoM: number | null;
  speedMs: number | null;
  directionDeg: number | null;
  operator: LonLat | null;
  operatorId: string;
  selfId: string;
  firstSeen: number;
  lastSeen: number;
  trail: LonLat[];
  simulated: boolean;
}

export interface Feed {
  status: FeedStatus;
  at: number;
  error?: string;
}

export type FeedName =
  | 'adsb' | 'nws' | 'tfr' | 'traffic' | 'transit' | 'power' | 'fire' | 'firms' | 'crime' | 's311' | 'quakes' | 'floods' | 'air'
  | 'airports' | 'storms' | 'wanted' | 'cams' | 'ships' | 'news' | 'drones';

/** Data produced by the leader window and mirrored to every pop-out. */
export interface DataState {
  aircraft: Aircraft[];
  trails: Record<string, TrailPoint[]>;
  orbiting: Record<string, { center: LonLat; radiusM: number; turns: number }>;
  alerts: NwsAlert[];
  incidents: Incident[];
  clusters: Cluster[];
  tfrs: Tfr[];
  traffic: TrafficEvent[];
  cameras: Camera[];
  transit: TransitDisruption[];
  outages: CountyOutage[];
  fires: FireIncident[];
  webcams: Camera[];
  crimes: Crime[];
  requests311: ServiceRequest[];
  hotspots: Hotspot[];
  quakes: Quake[];
  wanted: Wanted[];
  gauges: Gauge[];
  air: AirQuality | null;
  airportDelays: AirportDelay[];
  storms: StormReport[];
  ships: Ship[];
  news: NewsItem[];
  drones: DroneTrack[];
  brief: Brief | null;
  log: LogEntry[];
  feeds: Record<FeedName, Feed>;
}

export interface Layers {
  aircraft: boolean;
  trails: boolean;
  weather: boolean;
  aoi: boolean;
  tfr: boolean;
  traffic: boolean;
  transit: boolean;
  outages: boolean;
  fires: boolean;
  radio: boolean;
  crime: boolean;
  s311: boolean;
  hotspots: boolean;
  radar: boolean;
  quakes: boolean;
  floods: boolean;
  storms: boolean;
  ships: boolean;
  cameras: boolean;
  news: boolean;
  drones: boolean;
  areas: boolean;
}

/** Shared UI choices and settings, synced across windows. */
export interface SharedUi {
  packId: string;
  selectedHex: string | null;
  focus: { at: number; center: LonLat; zoom?: number } | null;
  ceilingAglFt: number | null;
  hideGround: boolean;
  layers: Layers;
  muted: boolean;
  settings: Settings;
  areas: WatchArea[];
  /** Saved locations the user searched for (custom city packs). */
  locations: CityPack[];
  /** One-shot requests any window can make of the leader (value = request time). */
  requests: { brief?: number; pushTest?: number; droneSim?: number };
}

export type RailTab = 'alerts' | 'sky' | 'news' | 'radio' | 'traffic' | 'hazards' | 'cameras' | 'areas';

/** Per-window choices. */
export interface LocalUi {
  basemap: Basemap;
  tab: RailTab;
  cameraId: string | null;
  drawing: LonLat[] | null;
  modal: 'settings' | 'brief' | null;
  tvChannel: string | null;
}

export interface State extends DataState, SharedUi, LocalUi {}

const PREFS_KEY = 'vigilante.prefs.v2';

function loadPrefs(): Partial<SharedUi & LocalUi> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs(s: State) {
  try {
    const { packId, ceilingAglFt, hideGround, layers, muted, basemap, tab } = s;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ packId, ceilingAglFt, hideGround, layers, muted, basemap, tab }));
  } catch {
    /* storage unavailable: prefs just won't persist */
  }
}

const prefs = loadPrefs();
const idleFeed: Feed = { status: 'idle', at: 0 };

export const EMPTY_DATA: Omit<DataState, 'log'> = {
  aircraft: [],
  trails: {},
  orbiting: {},
  alerts: [],
  incidents: [],
  clusters: [],
  tfrs: [],
  traffic: [],
  cameras: [],
  transit: [],
  outages: [],
  fires: [],
  webcams: [],
  crimes: [],
  requests311: [],
  hotspots: [],
  quakes: [],
  wanted: [],
  gauges: [],
  air: null,
  airportDelays: [],
  storms: [],
  ships: [],
  news: [],
  drones: [],
  brief: null,
  feeds: { adsb: idleFeed, nws: idleFeed, tfr: idleFeed, traffic: idleFeed, transit: idleFeed, power: idleFeed, fire: idleFeed, firms: idleFeed, crime: idleFeed, s311: idleFeed, quakes: idleFeed, floods: idleFeed, air: idleFeed, airports: idleFeed, storms: idleFeed, wanted: idleFeed, cams: idleFeed, ships: { status: 'off', at: 0 }, news: idleFeed, drones: { status: 'off', at: 0 } },
};

let state: State = {
  ...EMPTY_DATA,
  log: [],
  packId: prefs.packId ?? 'denver',
  selectedHex: null,
  focus: null,
  ceilingAglFt: prefs.ceilingAglFt === undefined ? 10_000 : prefs.ceilingAglFt,
  hideGround: prefs.hideGround ?? true,
  layers: { aircraft: true, trails: true, weather: true, aoi: true, tfr: true, traffic: true, transit: true, outages: true, fires: true, radio: true, crime: true, s311: false, hotspots: true, radar: false, quakes: true, floods: true, storms: true, ships: true, cameras: true, news: true, drones: true, areas: true, ...(prefs.layers ?? {}) },
  muted: prefs.muted ?? false,
  settings: DEFAULT_SETTINGS,
  areas: [],
  locations: [],
  requests: {},
  basemap: prefs.basemap ?? 'dark',
  tab: prefs.tab ?? 'alerts',
  cameraId: null,
  drawing: null,
  modal: null,
  tvChannel: null,
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  savePrefs(state);
  listeners.forEach((l) => l());
}

export function setFeed(name: FeedName, feed: Feed) {
  setState({ feeds: { ...state.feeds, [name]: feed } });
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
