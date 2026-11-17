import { distanceM, type LonLat } from './geo';
import type { Severity, Signal, SignalSource } from './signals';

/**
 * A developing incident: signals from different sources that line up in
 * space and time, e.g. a helicopter circling + a road closure + a news story
 * about the same blocks.
 */
export interface Cluster {
  id: string;
  signals: Signal[];
  sources: SignalSource[];
  center: LonLat;
  radiusM: number;
  firstAt: number;
  lastAt: number;
  severity: Severity;
  title: string;
}

export interface CorrelateOptions {
  radiusM: number; // max distance from the cluster center to join
  windowMs: number; // how far back to look
  gapMs: number; // max time since the cluster's last signal to join
  minSources: number; // distinct sources needed to call it an incident
}

export const DEFAULT_CORRELATE: CorrelateOptions = {
  radiusM: 1500,
  windowMs: 3 * 3600_000,
  gapMs: 60 * 60_000,
  minSources: 2,
};

/** Severity weights by source for the headline (an orbit or closure says more than a generic story). */
function headline(signals: Signal[]): Signal {
  return [...signals].sort((a, b) => b.severity - a.severity || a.at - b.at)[0];
}

export function correlate(signals: Signal[], now: number, opts: CorrelateOptions = DEFAULT_CORRELATE): Cluster[] {
  const recent = signals
    .filter((s) => s.location && now - s.at <= opts.windowMs)
    .sort((a, b) => a.at - b.at);
  const groups: { signals: Signal[]; center: LonLat }[] = [];
  for (const s of recent) {
    const loc = s.location!;
    let best: { g: (typeof groups)[number]; d: number } | null = null;
    for (const g of groups) {
      const last = g.signals[g.signals.length - 1].at;
      if (s.at - last > opts.gapMs) continue;
      const d = distanceM(g.center, loc);
      if (d <= opts.radiusM && (!best || d < best.d)) best = { g, d };
    }
    if (best) {
      if (!best.g.signals.some((x) => x.id === s.id)) best.g.signals.push(s);
      const pts = best.g.signals.map((x) => x.location!);
      best.g.center = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    } else groups.push({ signals: [s], center: loc });
  }

  return groups
    .map((g) => {
      const sources = [...new Set(g.signals.map((s) => s.source))];
      const top = headline(g.signals);
      const maxSev = Math.max(...g.signals.map((s) => s.severity));
      const severity = Math.min(4, maxSev + (sources.length >= 3 ? 1 : 0)) as Severity;
      return {
        id: `cluster:${g.signals[0].id}`,
        signals: g.signals,
        sources,
        center: g.center,
        radiusM: Math.max(200, ...g.signals.map((s) => distanceM(g.center, s.location!))),
        firstAt: g.signals[0].at,
        lastAt: g.signals[g.signals.length - 1].at,
        severity,
        title: top.title,
      };
    })
    .filter((c) => c.sources.length >= opts.minSources)
    .sort((a, b) => b.severity - a.severity || b.lastAt - a.lastAt);
}
