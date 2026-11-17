import { DEFAULT_PUSH, type PushSettings } from './rules';

export interface Settings {
  keys: { ga511: string; cotrip: string };
  push: PushSettings;
  brief: { enabled: boolean; time: string; hours: number; push: boolean };
  drones: { scan: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { ga511: '', cotrip: '' },
  push: DEFAULT_PUSH,
  brief: { enabled: true, time: '07:00', hours: 12, push: true },
  drones: { scan: false },
};

/** Fill in fields added in newer versions. */
export function withDefaults(s: Partial<Settings> | null): Settings {
  return {
    keys: { ...DEFAULT_SETTINGS.keys, ...(s?.keys ?? {}) },
    push: { ...DEFAULT_SETTINGS.push, ...(s?.push ?? {}) },
    brief: { ...DEFAULT_SETTINGS.brief, ...(s?.brief ?? {}) },
    drones: { ...DEFAULT_SETTINGS.drones, ...(s?.drones ?? {}) },
  };
}

export function randomTopic(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return `vigilante-${[...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}
