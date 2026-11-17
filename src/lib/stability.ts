import type { AirQuality, Crime, Gauge, Quake, StormReport, AirportDelay } from './intel';
import { gaugeSeverity, quakeSeverity, stormSeverity } from './intel';
import type { Cluster } from './correlate';
import type { Severity } from './signals';

/**
 * Neighborhood Stability Index (NSI): a 0-100 score for the watched area,
 * modeled on World Monitor's Country Instability Index but built from local,
 * verifiable signals. 100 = calm. Each component is a 0-100 *risk* with a
 * weight; the index is 100 minus the weighted risk, capped so a single
 * severe component (risk r) holds the score at or below 100 - 0.6r. Fully deterministic, so
 * the same inputs always give the same score and every point is explainable.
 */
export interface StabilityInputs {
  now: number;
  crimes: Crime[]; // last 7 days
  clusters: Cluster[];
  incidents: { kind: string; severity: Severity }[];
  nwsMaxSeverity: Severity; // 0 when no alerts
  storms: StormReport[];
  quakes: Quake[];
  gauges: Gauge[];
  air: AirQuality | null;
  wildfiresNear: number; // NIFC wildfires with severity >= 2
  hotspotsUnexplained: number;
  outageCustomers: number;
  transitSerious: number; // transit disruptions severity >= 2 (police/medical/accident)
  roadSerious: number; // road incidents severity >= 2
  airportDelays: AirportDelay[];
  orbits: number; // aircraft circling now
  squawks: number; // emergency squawks now
}

export interface StabilityComponent {
  key: 'crime' | 'incidents' | 'hazards' | 'fire' | 'infrastructure' | 'air';
  label: string;
  risk: number; // 0-100
  weight: number;
  detail: string;
}

export interface NeighborhoodRating {
  name: string;
  score: number; // 0-100 stability for that neighborhood (relative to the city this week)
  crimes: number;
  violent: number;
  /** Average position of this week's reports, for "show on map". */
  center: [number, number] | null;
}

export interface Stability {
  score: number;
  level: 'Stable' | 'Guarded' | 'Elevated' | 'High' | 'Severe';
  components: StabilityComponent[];
  neighborhoods: NeighborhoodRating[];
  violent48h: number;
  violentDailyAvg: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const DAY = 86_400_000;

export function levelFor(score: number): Stability['level'] {
  return score >= 80 ? 'Stable' : score >= 60 ? 'Guarded' : score >= 40 ? 'Elevated' : score >= 20 ? 'High' : 'Severe';
}

export function computeStability(i: StabilityInputs): Stability {
  // Crime: recent violent reports compared with this week's own daily average,
  // so a city's normal level isn't penalized, only a spike is.
  const violent = i.crimes.filter((c) => c.severity >= 2);
  const recent = violent.filter((c) => i.now - c.at < 2 * DAY).length;
  const dailyAvg = violent.length / 7;
  const expected48 = Math.max(1, dailyAvg * 2);
  const ratio = recent / expected48;
  // Gunfire is also judged against this week's own rate, so a city's baseline isn't a penalty.
  const gun = i.crimes.filter((c) => c.severity >= 3);
  const shootings = gun.filter((c) => i.now - c.at < 2 * DAY).length;
  const gunExpected = Math.max(1, (gun.length / 7) * 2);
  const crimeRisk = clamp(25 * Math.max(0, ratio - 0.5) + 15 * Math.max(0, shootings / gunExpected - 1));

  // Live incidents and developing clusters.
  const clusterRisk = i.clusters.reduce((s, c) => s + [0, 5, 10, 20, 35][c.severity], 0);
  const incidentRisk = i.incidents.reduce((s, x) => s + [0, 1, 3, 8, 15][x.severity], 0);
  const incRisk = clamp(clusterRisk + incidentRisk + 15 * i.squawks + 5 * i.orbits);

  // Natural hazards.
  const stormMax = Math.max(0, ...i.storms.map(stormSeverity));
  const quakeMax = Math.max(0, ...i.quakes.filter((q) => i.now - q.at < DAY).map(quakeSeverity));
  const floodMax = Math.max(0, ...i.gauges.map(gaugeSeverity));
  const hazardRisk = clamp([0, 8, 25, 50, 80][i.nwsMaxSeverity] + [0, 5, 15, 30, 50][stormMax] + [0, 5, 15, 35, 60][quakeMax] + [0, 5, 20, 40, 70][floodMax]);

  // Fire.
  // Satellite detections are noisy (farm burns, flares): capped so they inform but can't dominate.
  const fireRisk = clamp(20 * i.wildfiresNear + Math.min(30, 6 * i.hotspotsUnexplained));

  // Infrastructure.
  const infraRisk = clamp(Math.min(40, i.outageCustomers / 250) + 8 * i.transitSerious + 4 * i.roadSerious + 10 * i.airportDelays.filter((d) => /stop|closure/i.test(d.kind)).length);

  // Air quality.
  const aqi = i.air?.aqi ?? 0;
  const airRisk = clamp(aqi <= 50 ? 0 : aqi <= 100 ? (aqi - 50) * 0.4 : 20 + (aqi - 100) * 0.6);

  const components: StabilityComponent[] = [
    { key: 'crime', label: 'Violent crime', risk: crimeRisk, weight: 0.3, detail: `${recent} violent reports in 48 h vs ~${expected48.toFixed(0)} typical${shootings ? `, ${shootings} involving gunfire` : ''}` },
    { key: 'incidents', label: 'Active incidents', risk: incRisk, weight: 0.25, detail: `${i.clusters.length} developing, ${i.incidents.length} live alerts${i.orbits ? `, ${i.orbits} aircraft circling` : ''}` },
    { key: 'hazards', label: 'Weather & hazards', risk: hazardRisk, weight: 0.2, detail: [i.nwsMaxSeverity ? 'NWS alert active' : 'No NWS alerts', stormMax ? 'storm reports' : '', quakeMax ? 'recent quake' : '', floodMax ? 'river above action stage' : ''].filter(Boolean).join(', ') },
    { key: 'fire', label: 'Fire', risk: fireRisk, weight: 0.1, detail: `${i.wildfiresNear} active wildfires near, ${i.hotspotsUnexplained} unexplained satellite detections` },
    { key: 'infrastructure', label: 'Infrastructure', risk: infraRisk, weight: 0.1, detail: `${i.outageCustomers.toLocaleString('en-US')} customers out, ${i.transitSerious} serious transit, ${i.roadSerious} road incidents` },
    { key: 'air', label: 'Air quality', risk: airRisk, weight: 0.05, detail: i.air ? `AQI ${i.air.aqi} (${i.air.label})` : 'No reading' },
  ];
  // Weighted average, but one severe factor (e.g. an extreme weather warning)
  // must dominate rather than be averaged away.
  const risk = components.reduce((s, c) => s + c.risk * c.weight, 0);
  const maxRisk = Math.max(...components.map((c) => c.risk));
  const score = clamp(Math.min(100 - risk, 100 - 0.6 * maxRisk));
  return { score, level: levelFor(score), components, neighborhoods: rateNeighborhoods(i.crimes), violent48h: recent, violentDailyAvg: dailyAvg };
}

/** Per-neighborhood stability from this week's reports, relative to the busiest neighborhood. */
export function rateNeighborhoods(crimes: Crime[], top = 8): NeighborhoodRating[] {
  const m = new Map<string, { crimes: number; violent: number; weight: number; lon: number; lat: number }>();
  for (const c of crimes) {
    if (!c.neighborhood) continue;
    const r = m.get(c.neighborhood) ?? { crimes: 0, violent: 0, weight: 0, lon: 0, lat: 0 };
    r.crimes++;
    r.lon += c.location[0];
    r.lat += c.location[1];
    if (c.severity >= 2) r.violent++;
    r.weight += [0.3, 1, 3, 6][c.severity] ?? 1;
    m.set(c.neighborhood, r);
  }
  const max = Math.max(1, ...[...m.values()].map((r) => r.weight));
  return [...m.entries()]
    .map(([name, r]) => ({ name, crimes: r.crimes, violent: r.violent, score: clamp(100 - (r.weight / max) * 70), center: [r.lon / r.crimes, r.lat / r.crimes] as [number, number] }))
    .sort((a, b) => a.score - b.score)
    .slice(0, top);
}
