import { SOCRATA_CRIME } from './crimeSources';
import { hourHistogram, type Crime } from './intel';
import type { Severity } from './signals';
import type { Stability } from './stability';

export interface Insight {
  text: string;
  severity: Severity;
  source: string;
  /** Where on the map this refers to, if anywhere. */
  at?: [number, number];
  zoom?: number;
  /** A relevant page to open on click. */
  url?: string;
  /** Short name for the map marker. */
  label?: string;
  /** Aircraft to select on the map. */
  hex?: string;
}

/** Official police crime map pages. */
export const CRIME_MAP_URL: Record<string, string> = {
  denver: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department/Crime-Information',
  atlanta: 'https://atlantapd.org/community/crime-statistics/crime-maps',
  ...Object.fromEntries(Object.entries(SOCRATA_CRIME).map(([k, v]) => [k, v.mapUrl])),
};

type At = [number, number];

/**
 * Analyst-style observations computed from the live data, with no AI and no
 * key. Each one is a plain statement with numbers you can check.
 */
export function ruleInsights(a: {
  stability: Stability;
  crimes: Crime[];
  tz: string;
  orbits: { label: string; hex?: string; center?: At }[];
  alerts: { event: string }[];
  hotspots: number;
  hotspotsUnexplained: number;
  /** First unexplained detection, for "show on map". */
  hotspotAt?: At | null;
  quakes: { mag: number; place: string; location?: At; url?: string }[];
  air: { aqi: number; label: string } | null;
  transitSerious: { title: string; cause: string; location?: At | null; url?: string }[];
  outageCustomers: number;
  outageAt?: At | null;
  news: { title: string; severity: Severity; url?: string; pin?: At | null }[];
  center?: At;
  zoom?: number;
  crimeUrl?: string;
  weatherUrl?: string;
  airUrl?: string;
  powerUrl?: string;
}): Insight[] {
  const out: Insight[] = [];
  const s = a.stability;

  // Crime trend
  if (a.crimes.length) {
    const avg = s.violentDailyAvg * 2;
    const pct = avg > 0 ? Math.round(((s.violent48h - avg) / avg) * 100) : 0;
    if (s.violent48h && Math.abs(pct) >= 25)
      out.push({ text: `Violent crime reports in the last 48 h are ${pct > 0 ? `${pct}% above` : `${-pct}% below`} this week's average (${s.violent48h} vs ~${avg.toFixed(0)}).`, severity: pct > 50 ? 2 : pct > 0 ? 1 : 0, source: 'Crime', url: a.crimeUrl });
    else out.push({ text: `Violent crime is near this week's normal level (${s.violent48h} reports in 48 h).`, severity: 0, source: 'Crime', at: a.center, zoom: a.zoom, url: a.crimeUrl });

    const hot = s.neighborhoods.slice(0, 3).map((n) => `${n.name} (${n.crimes})`);
    if (hot.length) out.push({ text: `Most serious activity this week (reports): ${hot.join(', ')}.`, severity: 1, source: 'Crime', label: s.neighborhoods[0]?.name, at: s.neighborhoods[0]?.center ?? undefined, zoom: 14, url: a.crimeUrl });

    const hist = hourHistogram(a.crimes.filter((c) => c.severity >= 2), a.tz);
    const total = hist.reduce((x, y) => x + y, 0);
    if (total >= 8) {
      // Busiest 4-hour window (wrapping past midnight).
      let best = 0;
      let bestStart = 0;
      for (let h = 0; h < 24; h++) {
        const sum = [0, 1, 2, 3].reduce((x, k) => x + hist[(h + k) % 24], 0);
        if (sum > best) [best, bestStart] = [sum, h];
      }
      const fmt = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
      out.push({ text: `${Math.round((best / total) * 100)}% of violent reports this week happened between ${fmt(bestStart)} and ${fmt((bestStart + 4) % 24)}.`, severity: 0, source: 'Crime', url: a.crimeUrl });
    }
  }

  if (a.orbits.length) out.push({ text: `${a.orbits.length} aircraft circling now: ${a.orbits.map((o) => o.label).slice(0, 3).join(', ')}. Often police, news or medical activity.`, severity: 2, source: 'Aircraft', label: a.orbits[0].label, at: a.orbits[0].center, zoom: 13, hex: a.orbits[0].hex, url: a.orbits[0].hex ? `https://globe.adsb.lol/?icao=${a.orbits[0].hex}` : undefined });
  if (a.alerts.length) out.push({ text: `Weather: ${a.alerts.map((x) => x.event).slice(0, 3).join(', ')} in effect.`, severity: 2, source: 'NWS', at: a.center, zoom: 9, url: a.weatherUrl });
  if (a.hotspotsUnexplained) out.push({ text: `${a.hotspotsUnexplained} satellite heat detection${a.hotspotsUnexplained === 1 ? '' : 's'} inside the watch area with no known wildfire nearby. Often controlled burns or industrial heat, but worth a look.`, severity: 1, source: 'NASA FIRMS', label: 'Unexplained heat', at: a.hotspotAt ?? undefined, zoom: 13, url: a.hotspotAt ? `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${a.hotspotAt[0].toFixed(3)},${a.hotspotAt[1].toFixed(3)},12z` : undefined });
  else if (a.hotspots) out.push({ text: `${a.hotspots} satellite heat detections within 75 nm in 24 h, none unexplained inside the watch area.`, severity: 0, source: 'NASA FIRMS', at: a.center, zoom: 8, url: a.center ? `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${a.center[0].toFixed(3)},${a.center[1].toFixed(3)},9z` : undefined });
  const bigQuake = a.quakes.find((q) => q.mag >= 3);
  if (bigQuake) out.push({ text: `M${bigQuake.mag.toFixed(1)} earthquake ${bigQuake.place}.`, severity: 1, source: 'USGS', at: bigQuake.location, zoom: 9, url: bigQuake.url });
  if (a.air && a.air.aqi > 100) out.push({ text: `Air quality is ${a.air.label.toLowerCase()} (AQI ${a.air.aqi}). Limit time outdoors if sensitive.`, severity: a.air.aqi > 150 ? 2 : 1, source: 'Air', at: a.center, zoom: a.zoom, url: a.airUrl });
  if (a.transitSerious.length) out.push({ text: `Transit disruptions from ${[...new Set(a.transitSerious.map((t) => t.cause.toLowerCase()))].join(' / ')}: ${a.transitSerious.map((t) => t.title).slice(0, 3).join(', ')}.`, severity: 2, source: 'Transit', label: a.transitSerious[0].title, at: a.transitSerious[0].location ?? undefined, zoom: 15, url: a.transitSerious[0].url });
  if (a.outageCustomers >= 100) out.push({ text: `${a.outageCustomers.toLocaleString('en-US')} customers without power in reporting utilities.`, severity: a.outageCustomers >= 1000 ? 2 : 1, source: 'Power', at: a.outageAt ?? undefined, zoom: 10, url: a.powerUrl });
  const topNews = a.news.filter((n) => n.severity >= 2).slice(0, 2);
  topNews.forEach((n) => out.push({ text: `In the news: ${n.title}`, severity: 1, source: 'News', at: n.pin ?? undefined, zoom: 13, url: n.url }));

  const worst = [...s.components].sort((x, y) => y.risk * y.weight - x.risk * x.weight)[0];
  if (worst && worst.risk > 0) out.unshift({ text: `Stability ${s.score}/100 (${s.level}). Biggest factor: ${worst.label.toLowerCase()}, ${worst.detail}.`, severity: s.score < 60 ? 2 : 0, source: 'Index', at: a.center, zoom: a.zoom });
  else out.unshift({ text: `Stability ${s.score}/100 (${s.level}). No significant risk factors right now.`, severity: 0, source: 'Index', at: a.center, zoom: a.zoom });
  return out;
}
