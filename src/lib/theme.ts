/** App appearance: theme presets plus custom RGB colors and panel opacity. */
export type ThemeId = 'tactical' | 'greenred' | 'nightvision' | 'amber' | 'redlight' | 'steel' | 'custom';

export interface Appearance {
  theme: ThemeId;
  /** Hex colors (#rrggbb). Used as-is for 'custom'; presets fill them in. */
  accent: string;
  bg: string;
  panel: string;
  /** Warning color: elevated alerts, meters, NWS alert areas and the crime heatmap (orange by default). */
  alert: string;
  /** 0.4 to 1: how solid panels, tiles and map overlays are. */
  panelOpacity: number;
  /** Grid lines and scanlines behind the dashboard. */
  texture: boolean;
}

type Preset = { label: string; note: string; accent: string; bg: string; panel: string; alert: string };

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Preset> = {
  tactical: { label: 'Tactical cyan', note: 'Default · cyan and orange', accent: '#3dd6f5', bg: '#0b0f14', panel: '#0d131a', alert: '#ffb020' },
  greenred: { label: 'Green & red', note: 'Field green, red warnings', accent: '#3ee08f', bg: '#080d0b', panel: '#0c1410', alert: '#ff5a4a' },
  nightvision: { label: 'Night vision', note: 'Green phosphor', accent: '#39ff7a', bg: '#060b07', panel: '#0a120c', alert: '#ffb020' },
  amber: { label: 'Amber CRT', note: 'Warm, easy on the eyes', accent: '#ffb020', bg: '#0d0a05', panel: '#15110a', alert: '#ff7a45' },
  redlight: { label: 'Red low-light', note: 'Keeps night vision in a dark vehicle', accent: '#ff4d4f', bg: '#0b0606', panel: '#140b0b', alert: '#ffb020' },
  steel: { label: 'Steel', note: 'Muted blue-gray', accent: '#9ec9ff', bg: '#0a0d12', panel: '#10151d', alert: '#ffb020' },
};

/** Critical stays the same red in every theme, so the most urgent things always look the same. */
export const CRITICAL = '#ff4d4f';

/**
 * Severity ladder (0 none, 1 info, 2 warning, 3 serious, 4 critical). Warning is the
 * theme's alert color; serious sits halfway between it and critical.
 */
export function severityColors(alert: string): [string, string, string, string, string] {
  const a = hexToRgb(alert);
  return ['#8fa3b8', '#4c8dff', rgbToHex(...a), mix(a, hexToRgb(CRITICAL), 0.45), CRITICAL];
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'tactical', ...pick(THEMES.tactical), panelOpacity: 0.92, texture: true };

function pick(t: Preset) {
  return { accent: t.accent, bg: t.bg, panel: t.panel, alert: t.alert };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [61, 214, 245];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Choosing a preset copies its colors; editing a color switches to 'custom'. */
export function withTheme(a: Appearance, theme: ThemeId): Appearance {
  return theme === 'custom' ? { ...a, theme } : { ...a, theme, ...pick(THEMES[theme]) };
}

/** Lighten (amt > 0) a color toward white, for secondary surfaces and borders. */
function mix(rgb: [number, number, number], to: [number, number, number], amt: number): string {
  return rgbToHex(...(rgb.map((v, i) => v + (to[i] - v) * amt) as [number, number, number]));
}

function alertVars(alert: string): Record<string, string> {
  const [, , warn, hot] = severityColors(alert);
  return { '--warn': warn, '--warn-rgb': hexToRgb(warn).join(', '), '--hot': hot, '--hot-rgb': hexToRgb(hot).join(', ') };
}

/** CSS variables for an appearance; applied to :root. */
export function themeVars(a: Appearance): Record<string, string> {
  const accent = hexToRgb(a.accent);
  const bg = hexToRgb(a.bg);
  const panel = hexToRgb(a.panel);
  const op = Math.max(0.4, Math.min(1, a.panelOpacity));
  return {
    '--accent': rgbToHex(...accent),
    '--accent-rgb': accent.join(', '),
    '--bg': rgbToHex(...bg),
    '--bg-rgb': bg.join(', '),
    '--panel': mix(panel, accent, 0.02),
    '--panel-2': mix(panel, [255, 255, 255], 0.04),
    '--panel-rgb': panel.join(', '),
    '--panel-a': op.toFixed(2),
    '--line': mix(panel, accent, 0.1),
    '--line-2': mix(panel, accent, 0.17),
    '--texture': a.texture ? '1' : '0',
    ...alertVars(a.alert),
  };
}

export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(a))) root.style.setProperty(k, v);
}
