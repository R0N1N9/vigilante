import type { LonLat } from './geo';
import type { TeamMember } from './comms';

/** online: heard in the last 3 min · stale: last 15 min · offline: longer · dark: chose stealth. */
export type AgentStatus = 'online' | 'stale' | 'offline' | 'dark';

export const ONLINE_MS = 3 * 60_000;
export const STALE_MS = 15 * 60_000;

export function agentStatus(m: Pick<TeamMember, 'at' | 'dark'>, now = Date.now()): AgentStatus {
  if (m.dark) return 'dark';
  const age = now - m.at;
  return age < ONLINE_MS ? 'online' : age < STALE_MS ? 'stale' : 'offline';
}

export const STATUS_LABEL: Record<AgentStatus, string> = { online: 'ONLINE', stale: 'STALE', offline: 'OFFLINE', dark: 'DARK' };

/** Bounding box around every placed agent, padded so a lone agent still gets a sensible zoom. */
export function teamBounds(locations: LonLat[], padDeg = 0.004): [LonLat, LonLat] | null {
  if (!locations.length) return null;
  const xs = locations.map((l) => l[0]);
  const ys = locations.map((l) => l[1]);
  return [
    [Math.min(...xs) - padDeg, Math.min(...ys) - padDeg],
    [Math.max(...xs) + padDeg, Math.max(...ys) + padDeg],
  ];
}

export function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
}
