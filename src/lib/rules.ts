import { areasContaining, type WatchArea } from './areas';
import type { Severity } from './signals';
import type { LonLat } from './geo';

export interface PushSettings {
  enabled: boolean;
  server: string; // e.g. https://ntfy.sh
  topic: string;
  minSeverity: Severity;
  onlyWatchAreas: boolean;
  quietStart: string; // "22:00", empty = no quiet hours
  quietEnd: string; // "07:00"
  quietMinSeverity: Severity; // during quiet hours only this or higher gets through
}

export const DEFAULT_PUSH: PushSettings = {
  enabled: false,
  server: 'https://ntfy.sh',
  topic: '',
  minSeverity: 3,
  onlyWatchAreas: false,
  quietStart: '22:30',
  quietEnd: '06:30',
  quietMinSeverity: 4,
};

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Is local time (minutes since midnight) inside the quiet window? Handles windows that cross midnight. */
export function inQuietHours(localMinutes: number, start: string, end: string): boolean {
  const s = minutes(start);
  const e = minutes(end);
  if (s == null || e == null || s === e) return false;
  return s < e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
}

export function localMinutes(now: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export interface PushDecision {
  push: boolean;
  reason: string;
  areaNames: string[];
}

/** Decide whether something deserves a phone notification. */
export function shouldPush(
  item: { severity: Severity; location: LonLat | null; regional?: boolean },
  s: PushSettings,
  areas: WatchArea[],
  now: number,
  tz: string,
): PushDecision {
  const inAreas = areasContaining(item.location, areas.filter((a) => a.alerts));
  const areaNames = inAreas.map((a) => a.name);
  if (!s.enabled || !s.topic) return { push: false, reason: 'phone alerts off', areaNames };
  // Inside a watch area counts one step more urgent.
  const effective = Math.min(4, item.severity + (inAreas.length ? 1 : 0));
  if (s.onlyWatchAreas && !inAreas.length && !item.regional) return { push: false, reason: 'outside watch areas', areaNames };
  if (effective < s.minSeverity) return { push: false, reason: 'below threshold', areaNames };
  if (inQuietHours(localMinutes(now, tz), s.quietStart, s.quietEnd) && effective < s.quietMinSeverity)
    return { push: false, reason: 'quiet hours', areaNames };
  return { push: true, reason: 'ok', areaNames };
}

const NTFY_PRIORITY: Record<Severity, number> = { 0: 2, 1: 2, 2: 3, 3: 4, 4: 5 };
export const ntfyPriority = (s: Severity) => NTFY_PRIORITY[s];
