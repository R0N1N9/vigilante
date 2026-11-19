import type { LonLat } from './geo';
import { THEMES, type ThemeId } from './theme';

/**
 * Embed mode (web build): `embed.html` or `?embed=1`, plus
 *   ?view=dashboard|map           which main view to show
 *   ?city=denver|atlanta|lat,lon  where to watch
 *   ?theme=tactical|greenred|nightvision|amber|redlight|steel|netrunner|fieldop|nightop|grayzone
 * Anything unrecognized is ignored, so a bad parameter never breaks the page.
 */
export type EmbedView = 'dashboard' | 'map';
export type EmbedCity = { kind: 'pack'; id: 'denver' | 'atlanta' } | { kind: 'coords'; at: LonLat };

export interface EmbedOptions {
  embed: boolean;
  view: EmbedView | null;
  city: EmbedCity | null;
  theme: Exclude<ThemeId, 'custom'> | null;
}

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function parseCity(raw: string | null): EmbedCity | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'denver' || v === 'atlanta') return { kind: 'pack', id: v };
  const m = COORDS.exec(v);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { kind: 'coords', at: [lon, lat] };
}

export function parseTheme(raw: string | null): EmbedOptions['theme'] {
  const v = raw?.trim().toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(THEMES, v) ? (v as EmbedOptions['theme']) : null;
}

export function parseEmbed(search: string, pathname = ''): EmbedOptions {
  const q = new URLSearchParams(search);
  const flag = (q.get('embed') ?? '').toLowerCase();
  const embed = /(^|\/)embed(\.html)?$/.test(pathname) || flag === '1' || flag === 'true';
  const view = q.get('view');
  return {
    embed,
    // Outside embed mode ?view= names a pop-out window, so it's only read here in embed mode.
    view: embed && (view === 'dashboard' || view === 'map') ? view : null,
    city: parseCity(q.get('city')),
    theme: parseTheme(q.get('theme')),
  };
}

/** Embed page URL for given options (used by docs/About modal; mirrors web/public/embed.js). */
export function embedUrl(base: string, o: { view?: EmbedView; city?: string; theme?: string }): string {
  const q = new URLSearchParams();
  if (o.view) q.set('view', o.view);
  if (o.city) q.set('city', o.city);
  if (o.theme) q.set('theme', o.theme);
  const s = q.toString();
  return `${base.replace(/\/?$/, '/')}embed.html${s ? `?${s}` : ''}`;
}

/** True in the embedded page (embed.html or ?embed=1). */
export const isEmbed = (): boolean => typeof location !== 'undefined' && parseEmbed(location.search, location.pathname).embed;
