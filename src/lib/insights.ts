import { hourHistogram, type Crime } from './intel';
import type { Severity } from './signals';
import type { Stability } from './stability';

export interface Insight {
  text: string;
  severity: Severity;
  source: string;
}

/**
 * Analyst-style observations computed from the live data, with no AI and no
 * key. Each one is a plain statement with numbers you can check.
 */
export function ruleInsights(a: {
  stability: Stability;
  crimes: Crime[];
  tz: string;
  orbits: { label: string }[];
  alerts: { event: string }[];
  hotspots: number;
  hotspotsUnexplained: number;
  quakes: { mag: number; place: string }[];
  air: { aqi: number; label: string } | null;
  transitSerious: { title: string; cause: string }[];
  outageCustomers: number;
  news: { title: string; severity: Severity }[];
}): Insight[] {
  const out: Insight[] = [];
  const s = a.stability;

  // Crime trend
  if (a.crimes.length) {
    const avg = s.violentDailyAvg * 2;
    const pct = avg > 0 ? Math.round(((s.violent48h - avg) / avg) * 100) : 0;
    if (s.violent48h && Math.abs(pct) >= 25)
      out.push({ text: `Violent crime reports in the last 48 h are ${pct > 0 ? `${pct}% above` : `${-pct}% below`} this week's average (${s.violent48h} vs ~${avg.toFixed(0)}).`, severity: pct > 50 ? 2 : pct > 0 ? 1 : 0, source: 'Crime' });
    else out.push({ text: `Violent crime is near this week's normal level (${s.violent48h} reports in 48 h).`, severity: 0, source: 'Crime' });

    const hot = s.neighborhoods.slice(0, 3).map((n) => `${n.name} (${n.crimes})`);
    if (hot.length) out.push({ text: `Most serious activity this week (reports): ${hot.join(', ')}.`, severity: 1, source: 'Crime' });

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
      out.push({ text: `${Math.round((best / total) * 100)}% of violent reports this week happened between ${fmt(bestStart)} and ${fmt((bestStart + 4) % 24)}.`, severity: 0, source: 'Crime' });
    }
  }

  if (a.orbits.length) out.push({ text: `${a.orbits.length} aircraft circling now: ${a.orbits.map((o) => o.label).slice(0, 3).join(', ')}. Often police, news or medical activity.`, severity: 2, source: 'Aircraft' });
  if (a.alerts.length) out.push({ text: `Weather: ${a.alerts.map((x) => x.event).slice(0, 3).join(', ')} in effect.`, severity: 2, source: 'NWS' });
  if (a.hotspotsUnexplained) out.push({ text: `${a.hotspotsUnexplained} satellite heat detection${a.hotspotsUnexplained === 1 ? '' : 's'} inside the watch area with no known wildfire nearby. Often controlled burns or industrial heat, but worth a look.`, severity: 1, source: 'NASA FIRMS' });
  else if (a.hotspots) out.push({ text: `${a.hotspots} satellite heat detections within 75 nm in 24 h, none unexplained inside the watch area.`, severity: 0, source: 'NASA FIRMS' });
  const bigQuake = a.quakes.find((q) => q.mag >= 3);
  if (bigQuake) out.push({ text: `M${bigQuake.mag.toFixed(1)} earthquake ${bigQuake.place}.`, severity: 1, source: 'USGS' });
  if (a.air && a.air.aqi > 100) out.push({ text: `Air quality is ${a.air.label.toLowerCase()} (AQI ${a.air.aqi}). Limit time outdoors if sensitive.`, severity: a.air.aqi > 150 ? 2 : 1, source: 'Air' });
  if (a.transitSerious.length) out.push({ text: `Transit disruptions from ${[...new Set(a.transitSerious.map((t) => t.cause.toLowerCase()))].join(' / ')}: ${a.transitSerious.map((t) => t.title).slice(0, 3).join(', ')}.`, severity: 2, source: 'Transit' });
  if (a.outageCustomers >= 100) out.push({ text: `${a.outageCustomers.toLocaleString('en-US')} customers without power in reporting utilities.`, severity: a.outageCustomers >= 1000 ? 2 : 1, source: 'Power' });
  const topNews = a.news.filter((n) => n.severity >= 2).slice(0, 2);
  topNews.forEach((n) => out.push({ text: `In the news: ${n.title}`, severity: 1, source: 'News' }));

  const worst = [...s.components].sort((x, y) => y.risk * y.weight - x.risk * x.weight)[0];
  if (worst && worst.risk > 0) out.unshift({ text: `Stability ${s.score}/100 (${s.level}). Biggest factor: ${worst.label.toLowerCase()}, ${worst.detail}.`, severity: s.score < 60 ? 2 : 0, source: 'Index' });
  else out.unshift({ text: `Stability ${s.score}/100 (${s.level}). No significant risk factors right now.`, severity: 0, source: 'Index' });
  return out;
}
