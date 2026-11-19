import { DEFAULT_PUSH, type PushSettings } from './rules';
import type { Severity } from './signals';
import { DEFAULT_MESH_RADIO, type MeshRadioSettings } from './comms';
import { DEFAULT_APPEARANCE, type Appearance } from './theme';

export interface NotifySettings {
  desktop: boolean;
  desktopMinSeverity: Severity;
  webhookUrl: string;
  webhookFormat: 'slack' | 'discord' | 'teams' | 'json';
  webhookMinSeverity: Severity;
}

export const DEFAULT_NOTIFY: NotifySettings = { desktop: true, desktopMinSeverity: 3, webhookUrl: '', webhookFormat: 'slack', webhookMinSeverity: 3 };

export interface Settings {
  keys: { ga511: string; cotrip: string; ais: string; claude: string };
  push: PushSettings;
  brief: { enabled: boolean; time: string; hours: number; push: boolean };
  /** scan: Bluetooth. wifiIface: Linux monitor-mode interface for Wi-Fi Remote ID (e.g. wlan0mon), empty = off. */
  drones: { scan: boolean; wifiIface: string };
  /** Map look: 3D terrain and contour lines. */
  map: { terrain3d: boolean; contours: boolean; hillshade: boolean };
  /** Desktop notifications and a team chat webhook, for general alerts (monitors choose their own). */
  notify: NotifySettings;
  /** Colors, theme and panel opacity. */
  appearance: Appearance;
  /** Team chat identity and the Meshtastic radio connection. */
  team: { callsign: string; installId: string };
  mesh: MeshRadioSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { ga511: '', cotrip: '', ais: '', claude: '' },
  push: DEFAULT_PUSH,
  brief: { enabled: true, time: '07:00', hours: 12, push: true },
  drones: { scan: false, wifiIface: '' },
  map: { terrain3d: false, contours: true, hillshade: true },
  notify: DEFAULT_NOTIFY,
  appearance: DEFAULT_APPEARANCE,
  team: { callsign: '', installId: '' },
  mesh: DEFAULT_MESH_RADIO,
};

/** Fill in fields added in newer versions. */
export function withDefaults(s: Partial<Settings> | null): Settings {
  return {
    keys: { ...DEFAULT_SETTINGS.keys, ...(s?.keys ?? {}) },
    push: { ...DEFAULT_SETTINGS.push, ...(s?.push ?? {}) },
    brief: { ...DEFAULT_SETTINGS.brief, ...(s?.brief ?? {}) },
    drones: { ...DEFAULT_SETTINGS.drones, ...(s?.drones ?? {}) },
    map: { ...DEFAULT_SETTINGS.map, ...(s?.map ?? {}) },
    notify: { ...DEFAULT_SETTINGS.notify, ...(s?.notify ?? {}) },
    appearance: renamedTheme({ ...DEFAULT_SETTINGS.appearance, ...(s?.appearance ?? {}) }),
    team: { callsign: s?.team?.callsign ?? '', installId: s?.team?.installId || Math.random().toString(36).slice(2, 10) },
    mesh: { ...DEFAULT_SETTINGS.mesh, ...(s?.mesh ?? {}) },
  };
}

export function randomTopic(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return `vigilance-${[...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

/** Themes that were renamed: 'blackcamo' is now 'nightop', 'fieldmanual' is now 'fieldop', 'urbandigital' is now 'grayzone'. */
function renamedTheme(a: Appearance): Appearance {
  const t = a.theme as string;
  return t === 'blackcamo' ? { ...a, theme: 'nightop' } : t === 'fieldmanual' ? { ...a, theme: 'fieldop' } : t === 'urbandigital' ? { ...a, theme: 'grayzone' } : a;
}
