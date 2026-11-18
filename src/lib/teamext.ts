/**
 * Team features shared with Vigil (docs/TEAM_PROTOCOL.md): shared radio
 * frequencies (plain chat lines), stable teammate colours, what a teammate
 * is listening to, which device they use, and how often a phone reports.
 * Kept byte-compatible with Vigil's core Team.kt.
 */

// ---------------------------------------------------------------- frequencies

export const FREQ = '📻 FREQ';
export const FREQ_MODES = ['NFM', 'FM', 'AM', 'USB', 'LSB', 'DMR', 'P25'] as const;

export interface Freq {
  mhz: number;
  mode: string;
  tone: string;
  label: string;
  by: string;
  at: number;
}

/** "📻 FREQ 462.5625 MHz NFM · tone 67.0 · Team channel — Unit 7": a normal chat line every app (and ntfy) can read. */
export function freqText(mhz: number, mode: string, tone: string, label: string, callsign: string): string {
  return `${FREQ} ${mhz.toFixed(4)} MHz${mode.trim() ? ` ${mode.trim()}` : ''}${tone.trim() ? ` · tone ${tone.trim()}` : ''}${label.trim() ? ` · ${label.trim()}` : ''} — ${callsign}`;
}

const FREQ_RE = /^📻 FREQ ([0-9]{1,6}(?:\.[0-9]{1,6})?) MHz(?: ([A-Z0-9]{2,4}))?((?: · [^—]*?)*)(?: — (.+))?$/u;

export function parseFreq(text: string, from = '', at = 0): Freq | null {
  const g = FREQ_RE.exec(text.trim());
  if (!g) return null;
  const mhz = Number(g[1]);
  if (!(mhz > 0)) return null;
  const parts = (g[3] ?? '').split(' · ').map((s) => s.trim()).filter(Boolean);
  const tone = parts.find((p) => p.startsWith('tone '))?.slice(5) ?? '';
  const label = parts.filter((p) => !p.startsWith('tone ')).join(' · ');
  return { mhz, mode: g[2] ?? '', tone, label, by: g[4] || from, at };
}

/** Newest first, one per frequency and mode. */
export function teamFreqs(chat: { text: string; from: string; at: number }[]): Freq[] {
  const all = chat.map((m) => parseFreq(m.text, m.from, m.at)).filter((f): f is Freq => !!f).sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return all.filter((f) => {
    const k = `${f.mhz}|${f.mode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const fmtMhz = (f: number) => `${f.toFixed(4).replace(/0{1,3}$/, '')} MHz`;

// ---------------------------------------------------------------- colours

/** Ten distinct colours; a teammate keeps theirs in every app (FNV-1a of their device id, as Vigil). */
export const MEMBER_COLORS = ['#4CC9F0', '#FF9F1C', '#B57BFF', '#3DF2A7', '#FF6B9A', '#FFD84D', '#5B8CFF', '#FF6B4A', '#2EC4B6', '#E0A3FF'];

export function memberColor(id: string): string {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return MEMBER_COLORS[(h >>> 0) % MEMBER_COLORS.length];
}

/** "Unit 7" → "U7", "Bravo" → "BR". */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}

// ---------------------------------------------------------------- radio / device report fields

/** What a teammate is listening to (report category 'radio'). */
export interface Listening {
  f?: number;
  mode?: string;
  label?: string;
  sys?: string;
  sysName?: string;
}

/** The device a teammate uses (report category 'device'). */
export interface DeviceInfo {
  type?: 'android' | 'ios' | 'web' | 'desktop' | string;
  os?: string;
  model?: string;
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export function cleanListening(r: unknown): Listening | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Record<string, unknown>;
  const f = Number(o.f);
  const out: Listening = {};
  if (Number.isFinite(f) && f >= 0.01 && f <= 300_000) out.f = f;
  for (const [k, n] of [['mode', 8], ['label', 40], ['sys', 40], ['sysName', 60]] as const) {
    const v = str(o[k], n);
    if (v) out[k] = v;
  }
  return out.f != null || out.sys ? out : undefined;
}

export function cleanDevice(d: unknown): DeviceInfo | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const o = d as Record<string, unknown>;
  const out: DeviceInfo = {};
  for (const [k, n] of [['type', 12], ['os', 40], ['model', 60]] as const) {
    const v = str(o[k], n);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function describeListening(r: Listening | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  if (r.f != null) parts.push(`${fmtMhz(r.f)}${r.mode ? ` ${r.mode}` : ''}${r.label ? ` (${r.label})` : ''}`);
  if (r.sysName || r.sys) parts.push(`scanner: ${r.sysName || r.sys}`);
  return parts.join(' · ');
}

/** Platform even without the device category: Vigil is the Android app, "field" the web page. */
export function platformLabel(type: string | undefined, app: string | undefined): string {
  if (type === 'android') return 'Android';
  if (type === 'ios') return 'iPhone/iPad';
  if (type === 'web') return 'Web browser';
  if (type === 'desktop') return 'Desktop';
  if (app === 'vigil') return 'Android (Vigil app)';
  if (app === 'field') return 'Web browser';
  return app ?? '';
}

export function describeDevice(d: DeviceInfo | undefined, app: string | undefined): string {
  const s = [d?.os, d?.model].filter(Boolean).join(' · ');
  return s || platformLabel(d?.type, app);
}

/** Fill the device category from a browser's user agent: {type:'web', os:'iOS 18', model:'Safari'}. */
export function deviceFromUA(ua: string): DeviceInfo {
  const ios = /(?:iPhone|iPad|iPod).*?OS (\d+)[_.]?(\d+)?/.exec(ua);
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
  const mac = /Mac OS X (\d+)[_.](\d+)/.exec(ua);
  const win = /Windows NT (\d+\.\d+)/.exec(ua);
  const os = ios ? `iOS ${ios[1]}` : android ? `Android ${android[1]}` : mac && !/Mobile/.test(ua) ? 'macOS' : win ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const model = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /CriOS\/|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return { type: 'web', ...(os ? { os } : {}), ...(model ? { model } : {}) };
}

// ---------------------------------------------------------------- report rate

/** How often a sharing phone reports (Vigil's presets): heartbeats stay under a minute so the console shows ONLINE. */
export const RATES = {
  live: { label: 'Live', minS: 3, moveM: 10, heartbeatS: 30, note: 'Every 3 s on the move: smooth tracking, most battery and data' },
  normal: { label: 'Normal', minS: 8, moveM: 20, heartbeatS: 45, note: 'Every 8 s on the move' },
  saver: { label: 'Battery saver', minS: 30, moveM: 50, heartbeatS: 55, note: 'Every 30 s on the move' },
  low: { label: 'Low', minS: 60, moveM: 100, heartbeatS: 58, note: 'About once a minute: presence, not tracking' },
} as const;
export type RateId = keyof typeof RATES;

// ---------------------------------------------------------------- recon

export const RECON_PREFIX = 'Recon: ';
export const RECON_NOTE = 'Photos requested: go and look, post what you see.';
export const isReconName = (name: string) => name.startsWith(RECON_PREFIX);
export const reconName = (what: string) => RECON_PREFIX + (what.trim() || 'this spot').slice(0, 60 - RECON_PREFIX.length);

// ---------------------------------------------------------------- shared scanner feeds

/** "📻 LISTEN Denver Fire Alerting & EMS · Denver Fire — Unit 7", with the player link as the message's click URL. */
export const LISTEN = '📻 LISTEN';
export const listenText = (name: string, agency: string, callsign: string) => `${LISTEN} ${name}${agency ? ` · ${agency}` : ''} — ${callsign}`;
export const isListen = (text: string) => text.startsWith(LISTEN);
