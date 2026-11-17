export function fmtTime(ms: number, tz: string, seconds = false): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: false,
  }).format(ms);
}

export function fmtAgo(ms: number, now = Date.now()): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export const fmtNum = (n: number | null | undefined, unit = '') => (n == null ? '—' : `${Math.round(n).toLocaleString('en-US')}${unit}`);

/** Short zone name for a time zone, e.g. "MST" or "EDT". */
export function tzAbbr(ms: number, tz: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}
