import type { VoiceClip } from './engine/voice';
import type { PhotoInfo } from './engine/photos';
import { useSyncExternalStore } from 'react';
import type { Aircraft } from '../lib/adsb';
import type { WatchArea } from '../lib/areas';
import type { Monitor, MonitorHit } from '../lib/monitors';
import type { ChatMessage, SharedSpot, TeamChannel, TeamMember } from '../lib/comms';
import type { Mark, Waypoint } from '../lib/waypoints';
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
import type { Stability } from '../lib/stability';
import type { Insight } from '../lib/insights';
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
  stability: Stability | null;
  stabilityHistory: { t: number; score: number }[];
  insights: Insight[];
  ai: { text: string; at: number; error?: string; loading?: boolean } | null;
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
  team: boolean;
}

/** Shared UI choices and settings, synced across windows. */
export interface SharedUi {
  packId: string;
  selectedHex: string | null;
  /** Where the map should fly to; label/url drive the locator marker. */
  focus: { at: number; center: LonLat; zoom?: number; label?: string; bounds?: [LonLat, LonLat] } | null;
  ceilingAglFt: number | null;
  hideGround: boolean;
  layers: Layers;
  muted: boolean;
  settings: Settings;
  areas: WatchArea[];
  /** Saved locations the user searched for (custom city packs). */
  locations: CityPack[];
  /** One-shot requests any window can make of the leader (value = request time). */
  requests: { brief?: number; pushTest?: number; droneSim?: number; ai?: number; notifyTest?: number };
  /** User-defined alert rules and what they caught (acknowledged from any window). */
  monitors: Monitor[];
  hits: MonitorHit[];
  /** Team chat: channels, messages (outgoing ones start as 'sending'), teammates' positions, radio status. */
  channels: TeamChannel[];
  chat: ChatMessage[];
  team: TeamMember[];
  /** Waypoints sent to agents (shared across windows and consoles on the channel). */
  waypoints: Waypoint[];
  /** Shared map marks: pings, markers, areas of interest, objectives. */
  marks: Mark[];
  /** Push-to-talk clips heard this session (metadata only; audio is fetched again to replay). */
  voice: VoiceClip[];
  /** Team photos (metadata; the JPEGs live in IndexedDB on this device). */
  photos: PhotoInfo[];
  /** Someone is talking right now (shown in every window). */
  voiceRx: { by: string; until: number } | null;
  meshStatus: { state: 'off' | 'connecting' | 'connected' | 'error' | 'disconnected'; detail: string; node?: string; radioChannels?: { index: number; name: string }[] };
}

export type RailTab = 'alerts' | 'team' | 'sky' | 'news' | 'radio' | 'traffic' | 'hazards' | 'cameras' | 'areas';

/** Per-window choices. */
export interface LocalUi {
  basemap: Basemap;
  tab: RailTab;
  cameraId: string | null;
  drawing: LonLat[] | null;
  /** Monitor id waiting for a map click to set its center. */
  pickPoint: string | null;
  modal: 'settings' | 'brief' | 'invite' | 'poster' | 'agent' | 'waypoint' | 'mark' | 'about' | 'photo' | 'photo-send' | 'freq' | null;
  /** Photo open in the viewer, or what a new photo is attached to. */
  photoId: string | null;
  photoDraft: { at?: [number, number]; mark?: string } | null;
  /** Mark being placed (new, with a kind) or viewed (existing id). */
  markDraft: { at: [number, number]; kind?: import('../lib/waypoints').MarkKind; id?: string; recon?: boolean } | null;
  /** Waypoint being placed (new) or viewed (existing id). */
  waypointDraft: { at: [number, number]; id?: string; name?: string; note?: string; urgent?: boolean } | null;
  /** FBI poster open in the poster view. */
  posterId: string | null;
  /** Channel whose invite is open. */
  inviteChannelId: string | null;
  /** When this window last looked at the Team tab (for the unread badge). */
  teamSeenAt: number;
  /** Text/spot waiting in the Team composer (from a Share button). */
  teamDraft: { text: string; spot?: SharedSpot; url?: string } | null;
  /** Invite opened from a #join= link, waiting for the user to confirm. */
  joinCode: string | null;
  tvChannel: string | null;
  mainView: 'map' | 'dashboard' | 'team';
  /** When the team was last highlighted on the map (markers pulse for a few seconds). */
  teamHighlight: number;
  /** Agent whose profile is open. */
  agentId: string | null;
  /** Team channel push-to-talk transmits on. */
  voiceChannelId: string | null;
  /** Running inside the Field Agent phone app: posts as the agent, not the control center. */
  fieldMode: boolean;
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
    const { packId, ceilingAglFt, hideGround, layers, muted, basemap, tab, mainView } = s;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ packId, ceilingAglFt, hideGround, layers, muted, basemap, tab, mainView }));
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
  stability: null,
  stabilityHistory: [],
  insights: [],
  ai: null,
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
  layers: { aircraft: true, trails: true, weather: true, aoi: true, tfr: true, traffic: true, transit: true, outages: true, fires: true, radio: true, crime: true, s311: false, hotspots: true, radar: false, quakes: true, floods: true, storms: true, ships: true, cameras: true, news: true, drones: true, areas: true, team: true, ...(prefs.layers ?? {}) },
  muted: prefs.muted ?? false,
  settings: DEFAULT_SETTINGS,
  areas: [],
  locations: [],
  requests: {},
  monitors: [],
  hits: [],
  channels: [],
  chat: [],
  team: [],
  meshStatus: { state: 'off', detail: '' },
  waypoints: [],
  marks: [],
  voice: [],
  photos: [],
  voiceRx: null,
  basemap: prefs.basemap ?? 'dark',
  tab: typeof location !== 'undefined' && /#join=VG1\./.test(location.hash) ? 'team' : (prefs.tab ?? 'alerts'),
  cameraId: null,
  drawing: null,
  pickPoint: null,
  modal: null,
  inviteChannelId: null,
  posterId: null,
  waypointDraft: null,
  markDraft: null,
  teamSeenAt: Date.now(),
  teamDraft: null,
  joinCode: typeof location !== 'undefined' && /#join=VG1\./.test(location.hash) ? decodeURIComponent(location.hash.slice(6)) : null,
  tvChannel: null,
  mainView: prefs.mainView ?? 'map',
  teamHighlight: 0,
  agentId: null,
  voiceChannelId: null,
  fieldMode: false,
  photoId: null,
  photoDraft: null,
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
