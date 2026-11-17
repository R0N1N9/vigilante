import { DEFAULT_PUSH, type PushSettings } from './rules';

export interface Settings {
  keys: { ga511: string; cotrip: string; ais: string; claude: string };
  push: PushSettings;
  brief: { enabled: boolean; time: string; hours: number; push: boolean };
  /** scan: Bluetooth. wifiIface: Linux monitor-mode interface for Wi-Fi Remote ID (e.g. wlan0mon), empty = off. */
  drones: { scan: boolean; wifiIface: string };
  /** Map look: 3D terrain and contour lines. */
  map: { terrain3d: boolean; contours: boolean; hillshade: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { ga511: '', cotrip: '', ais: '', claude: '' },
  push: DEFAULT_PUSH,
  brief: { enabled: true, time: '07:00', hours: 12, push: true },
  drones: { scan: false, wifiIface: '' },
  map: { terrain3d: false, contours: true, hillshade: true },
};

/** Fill in fields added in newer versions. */
export function withDefaults(s: Partial<Settings> | null): Settings {
  return {
    keys: { ...DEFAULT_SETTINGS.keys, ...(s?.keys ?? {}) },
    push: { ...DEFAULT_SETTINGS.push, ...(s?.push ?? {}) },
    brief: { ...DEFAULT_SETTINGS.brief, ...(s?.brief ?? {}) },
    drones: { ...DEFAULT_SETTINGS.drones, ...(s?.drones ?? {}) },
    map: { ...DEFAULT_SETTINGS.map, ...(s?.map ?? {}) },
  };
}

export function randomTopic(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return `vigilante-${[...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}
