import { useSyncExternalStore } from 'react';
import type { Aircraft } from '../lib/adsb';
import type { NwsAlert } from '../lib/nws';
import type { TrailPoint } from '../lib/orbit';
import type { LonLat } from '../lib/geo';

export type Basemap = 'dark' | 'satellite';
export type FeedStatus = 'idle' | 'live' | 'stale' | 'error';

export interface Incident {
  id: string;
  kind: 'orbit' | 'squawk' | 'weather';
  severity: 0 | 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  at: number;
  location: LonLat | null;
  hex?: string;
  alertId?: string;
}

export interface LogEntry {
  id: string;
  at: number;
  severity: 0 | 1 | 2 | 3 | 4;
  text: string;
}

/** Data produced by the leader window and mirrored to every pop-out. */
export interface DataState {
  aircraft: Aircraft[];
  trails: Record<string, TrailPoint[]>;
  orbiting: Record<string, { center: LonLat; radiusM: number; turns: number }>;
  alerts: NwsAlert[];
  incidents: Incident[];
  log: LogEntry[];
  feeds: { adsb: { status: FeedStatus; at: number; error?: string }; nws: { status: FeedStatus; at: number; error?: string } };
}

/** Shared UI choices, synced across windows. */
export interface SharedUi {
  packId: string;
  selectedHex: string | null;
  focus: { at: number; center: LonLat; zoom?: number } | null;
  ceilingAglFt: number | null;
  hideGround: boolean;
  layers: { aircraft: boolean; trails: boolean; weather: boolean; aoi: boolean };
  muted: boolean;
}

/** Per-window choices. */
export interface LocalUi {
  basemap: Basemap;
}

export interface State extends DataState, SharedUi, LocalUi {}

const PREFS_KEY = 'vigilante.prefs.v1';

function loadPrefs(): Partial<SharedUi & LocalUi> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function savePrefs(s: State) {
  try {
    const { packId, ceilingAglFt, hideGround, layers, muted, basemap } = s;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ packId, ceilingAglFt, hideGround, layers, muted, basemap }));
  } catch {
    /* storage unavailable: prefs just won't persist */
  }
}

const prefs = loadPrefs();

let state: State = {
  aircraft: [],
  trails: {},
  orbiting: {},
  alerts: [],
  incidents: [],
  log: [],
  feeds: { adsb: { status: 'idle', at: 0 }, nws: { status: 'idle', at: 0 } },
  packId: prefs.packId ?? 'denver',
  selectedHex: null,
  focus: null,
  ceilingAglFt: prefs.ceilingAglFt === undefined ? 10_000 : prefs.ceilingAglFt,
  hideGround: prefs.hideGround ?? true,
  layers: { aircraft: true, trails: true, weather: true, aoi: true, ...(prefs.layers ?? {}) },
  muted: prefs.muted ?? false,
  basemap: prefs.basemap ?? 'dark',
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

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
