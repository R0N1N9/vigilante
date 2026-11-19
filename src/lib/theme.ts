/** App appearance: theme presets plus custom RGB colors and panel opacity. */
export type ThemeId = 'tactical' | 'greenred' | 'nightvision' | 'amber' | 'redlight' | 'steel' | 'netrunner' | 'fieldop' | 'nightop' | 'custom';

export interface Appearance {
  theme: ThemeId;
  /** Hex colors (#rrggbb). Used as-is for 'custom'; presets fill them in. */
  accent: string;
  bg: string;
  panel: string;
  /** Warnings (amber by default) and critical alerts (red by default); 'serious' is blended between them. */
  alert: string;
  critical: string;
  /** 0.4 to 1: how solid panels, tiles and map overlays are. */
  panelOpacity: number;
  /** Grid lines and scanlines behind the dashboard. */
  texture: boolean;
}

type Palette = { label: string; note: string; accent: string; bg: string; panel: string; alert: string; critical: string; /** Second swatch color, if not the alert color. */ swatch?: string; /** Extra styling beyond colors (fonts, panel shapes, glow). */ skin?: string };

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Palette> = {
  tactical: { label: 'Tactical cyan', note: 'Cyan with amber alerts (default)', accent: '#3dd6f5', bg: '#0b0f14', panel: '#0d131a', alert: '#ffb020', critical: '#ff4d4f' },
  greenred: { label: 'Green & red', note: 'Ops green with red alerts', accent: '#2ee59d', bg: '#070d0a', panel: '#0b1410', alert: '#ff5c5c', critical: '#ff2a6d' },
  nightvision: { label: 'Night vision', note: 'Green phosphor', accent: '#39ff7a', bg: '#060b07', panel: '#0a120c', alert: '#ffb020', critical: '#ff4d4f' },
  amber: { label: 'Amber CRT', note: 'Warm, easy on the eyes', accent: '#ffb020', bg: '#0d0a05', panel: '#15110a', alert: '#ff7a45', critical: '#ff4d4f' },
  redlight: { label: 'Red low-light', note: 'Keeps night vision in a dark vehicle', accent: '#ff4d4f', bg: '#0b0606', panel: '#140b0b', alert: '#ffb020', critical: '#ff2a9d' },
  steel: { label: 'Steel', note: 'Muted blue-gray', accent: '#9ec9ff', bg: '#0a0d12', panel: '#10151d', alert: '#ffb020', critical: '#ff4d4f' },
  netrunner: { label: 'Netrunner', note: 'Cyan data, red chrome, green signal', accent: '#5df2ee', bg: '#050a0a', panel: '#0a1314', alert: '#f2e04a', critical: '#ff4a55', swatch: '#ff5f5a', skin: 'netrunner' },
  fieldop: { label: 'Field Op', note: 'Muted green, OCP-style camo', accent: '#c2b893', bg: '#0f110d', panel: '#1a1e17', alert: '#c9a227', critical: '#b0472c', swatch: '#4e5a3c', skin: 'fieldop' },
  nightop: { label: 'Night Op', note: 'Black, flat dark earth, a touch of red', accent: '#c2a77a', bg: '#0b0b0a', panel: '#171614', alert: '#d0a24c', critical: '#b8322a', swatch: '#2e2c28', skin: 'nightop' },
};

export const DEFAULT_APPEARANCE: Appearance = { theme: 'tactical', ...pick(THEMES.tactical), panelOpacity: 0.92, texture: true };

function pick(t: Palette) {
  return { accent: t.accent, bg: t.bg, panel: t.panel, alert: t.alert, critical: t.critical };
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

/** CSS variables for an appearance; applied to :root. */
export function themeVars(a: Appearance): Record<string, string> {
  const accent = hexToRgb(a.accent);
  const bg = hexToRgb(a.bg);
  const panel = hexToRgb(a.panel);
  const op = Math.max(0.4, Math.min(1, a.panelOpacity));
  const warn = hexToRgb(a.alert ?? '#ffb020');
  const crit = hexToRgb(a.critical ?? '#ff4d4f');
  const serious = warn.map((v, i) => Math.round(v + (crit[i] - v) * 0.5)) as [number, number, number];
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
    '--warn': rgbToHex(...warn),
    '--warn-rgb': warn.join(', '),
    '--crit': rgbToHex(...crit),
    '--crit-rgb': crit.join(', '),
    '--serious': rgbToHex(...serious),
    '--serious-rgb': serious.join(', '),
  };
}

export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(a))) root.style.setProperty(k, v);
  const skin = a.theme === 'custom' ? undefined : THEMES[a.theme]?.skin;
  if (skin) root.dataset.skin = skin;
  else delete root.dataset.skin;
}
