import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../../lib/http';
import { distanceM, NM_TO_M } from '../../lib/geo';
import { ruleInsights } from '../../lib/insights';
import { getPack } from '../../lib/packs';
import { computeStability } from '../../lib/stability';
import type { Severity } from '../../lib/signals';
import { publishData } from '../bus';
import { getState, setState } from '../store';
import { ctx, log } from './core';

const HISTORY_POINTS = 24 * 12; // 24 h at 5-minute samples
let lastSample = 0;

/** Recompute the stability index and rule-based insights from current state. */
export function refreshDashboard() {
  const s = getState();
  const now = Date.now();
  const packNow = getPack(ctx.packId);
  // Only detections inside the watch radius count toward the index.
  const hotspotsUnexplained = s.hotspots.filter((h) => distanceM(h.location, packNow.center) <= packNow.radiusNm * NM_TO_M && !s.fires.some((f) => distanceM(f.location, h.location) < 5000)).length;
  const transitSerious = s.transit.filter((t) => t.severity >= 2);
  const outageCustomers = s.outages.reduce((n, o) => n + o.customers, 0);
  const nwsMax = Math.max(0, ...s.incidents.filter((i) => i.kind === 'weather').map((i) => i.severity)) as Severity;
  const stability = computeStability({
    now,
    crimes: s.crimes,
    clusters: s.clusters,
    incidents: s.incidents.filter((i) => !['weather', 'tfr', 'air'].includes(i.kind)),
    nwsMaxSeverity: nwsMax,
    storms: s.storms,
    quakes: s.quakes,
    gauges: s.gauges,
    air: s.air,
    // Only uncontained fires reasonably close (within 2x the watch radius) count as "near".
    wildfiresNear: s.fires.filter((f) => f.severity >= 2 && f.distNm <= packNow.radiusNm * 2 && (f.containedPct ?? 0) < 90).length,
    hotspotsUnexplained,
    outageCustomers,
    transitSerious: transitSerious.length,
    roadSerious: s.traffic.filter((t) => t.severity >= 2).length,
    airportDelays: s.airportDelays,
    orbits: Object.keys(s.orbiting).length,
    squawks: s.aircraft.filter((a) => a.emergency).length,
  });
  const pack = getPack(ctx.packId);
  const insights = ruleInsights({
    stability,
    crimes: s.crimes,
    tz: pack.timezone,
    orbits: Object.keys(s.orbiting).map((hex) => {
      const a = s.aircraft.find((x) => x.hex === hex);
      return { label: a ? `${a.callsign}${a.type ? ` (${a.type})` : ''}` : hex };
    }),
    alerts: s.alerts,
    hotspots: s.hotspots.length,
    hotspotsUnexplained,
    quakes: s.quakes,
    air: s.air,
    transitSerious,
    outageCustomers,
    news: s.news.filter((n) => n.local),
  });
  let history = s.stabilityHistory;
  if (now - lastSample >= 5 * 60_000) {
    lastSample = now;
    history = [...history, { t: now, score: stability.score }].slice(-HISTORY_POINTS);
  }
  setState({ stability, insights, stabilityHistory: history });
  publishData();
}

export function resetDashboard() {
  lastSample = 0;
  setState({ stability: null, stabilityHistory: [], insights: [], ai: null });
}

/** Compact, non-identifying snapshot for the optional AI briefing. */
function snapshot(): string {
  const s = getState();
  const pack = getPack(ctx.packId);
  return JSON.stringify({
    area: `${pack.name}, ${pack.region}`,
    localTime: new Date().toLocaleString('en-US', { timeZone: pack.timezone }),
    stability: s.stability && { score: s.stability.score, level: s.stability.level, components: s.stability.components.map((c) => ({ c: c.label, risk: c.risk, detail: c.detail })) },
    neighborhoodsMostReports: s.stability?.neighborhoods.slice(0, 6).map((n) => ({ name: n.name, reports7d: n.crimes, violent: n.violent })),
    crimeByCategory7d: Object.entries(s.crimes.reduce<Record<string, number>>((m, c) => ((m[c.category] = (m[c.category] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
    developingIncidents: s.clusters.slice(0, 5).map((c) => ({ title: c.title, sources: c.sources, severity: c.severity })),
    liveAlerts: s.incidents.slice(0, 12).map((i) => ({ kind: i.kind, title: i.title, detail: i.detail, severity: i.severity })),
    weatherAlerts: s.alerts.map((a) => a.event),
    airQuality: s.air && { aqi: s.air.aqi, label: s.air.label },
    stormReports24h: s.storms.slice(0, 6).map((r) => `${r.type} ${r.city}`),
    transit: s.transit.filter((t) => t.severity >= 1).slice(0, 6).map((t) => `${t.title}: ${t.cause || t.effect}`),
    powerOutCustomers: s.outages.reduce((n, o) => n + o.customers, 0),
    airportDelays: s.airportDelays.map((d) => `${d.airport} ${d.kind}: ${d.reason}`),
    localHeadlines: s.news.filter((n) => n.local && n.severity >= 1).slice(0, 8).map((n) => n.title),
    ruleBasedObservations: s.insights.map((i) => i.text),
  });
}

export async function requestAiBrief() {
  const key = getState().settings.keys.claude;
  if (!isTauri()) return setState({ ai: { text: '', at: Date.now(), error: 'AI insights need the desktop app.' } });
  if (!key) return setState({ ai: { text: '', at: Date.now(), error: 'Add a Claude API key in Settings → Optional keys.' } });
  setState({ ai: { ...(getState().ai ?? { text: '', at: 0 }), loading: true, error: undefined } });
  publishData();
  try {
    const text = await invoke<string>('ai_brief', { key, snapshot: snapshot() });
    setState({ ai: { text, at: Date.now() } });
    log('AI     Briefing updated', 0);
  } catch (e) {
    setState({ ai: { text: getState().ai?.text ?? '', at: getState().ai?.at ?? 0, error: String(e) } });
  }
  publishData();
}
