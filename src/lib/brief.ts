import type { Cluster } from './correlate';
import type { Place } from './packs';
import { describeLocation } from './places';
import type { Signal } from './signals';

export interface Brief {
  packId: string;
  generatedAt: number;
  from: number;
  to: number;
  headline: string;
  sections: { heading: string; items: string[] }[];
  pushText: string;
}

const plural = (n: number, w: string) => (n === 1 ? `1 ${w}` : `${n} ${/[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`);

function timeOf(ms: number, tz: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ms);
}

/**
 * Rule-based situation brief for a time window (e.g. overnight). Written to
 * read like a dispatcher's shift summary. An optional cloud-AI rewrite can be
 * layered on later; this works with no AI at all.
 */
export function buildBrief(args: {
  packId: string;
  packName: string;
  tz: string;
  from: number;
  to: number;
  history: Signal[];
  clusters: Cluster[];
  places: Place[];
}): Brief {
  const { tz, from, to, places } = args;
  const sig = args.history.filter((s) => s.packId === args.packId && s.at >= from && s.at <= to);
  const by = (src: Signal['source'], kind?: string) => sig.filter((s) => s.source === src && (!kind || s.kind === kind));
  const where = (s: Signal) => describeLocation(s.location, places);
  const sections: Brief['sections'] = [];

  const clusters = args.clusters.filter((c) => c.lastAt >= from && c.firstAt <= to);
  if (clusters.length)
    sections.push({
      heading: 'Developing incidents',
      items: clusters.slice(0, 5).map((c) => {
        const loc = describeLocation(c.center, places);
        return `${c.title}${loc ? ` ${loc}` : ''}, ${timeOf(c.firstAt, tz)}–${timeOf(c.lastAt, tz)} (${c.sources.length} sources: ${c.sources.join(', ')})`;
      }),
    });

  const orbits = by('adsb', 'orbit');
  const squawks = by('adsb', 'squawk');
  const helis = by('adsb', 'heli');
  const air: string[] = [];
  if (helis.length) air.push(`${plural(helis.length, 'helicopter')} entered the area.`);
  orbits.slice(0, 4).forEach((o) => air.push(`${o.detail.split(' · ')[0]} circled ${where(o) || 'the area'} at ${timeOf(o.at, tz)}.`));
  squawks.forEach((s) => air.push(`${s.title}: ${s.detail} at ${timeOf(s.at, tz)}.`));
  if (air.length) sections.push({ heading: 'Air activity', items: air });

  const wx = by('nws');
  if (wx.length) sections.push({ heading: 'Weather', items: wx.slice(0, 5).map((w) => `${w.title} (${timeOf(w.at, tz)})`) });

  const traffic = by('traffic').filter((t) => t.severity >= 2);
  if (traffic.length)
    sections.push({
      heading: 'Roads',
      items: traffic.slice(0, 5).map((t) => `${t.title}${where(t) ? ` ${where(t)}` : ''} at ${timeOf(t.at, tz)}.`),
    });

  const news = by('news').sort((a, b) => b.severity - a.severity || b.at - a.at);
  if (news.length) sections.push({ heading: 'In the news', items: news.slice(0, 6).map((n) => `${n.title}${n.detail ? ` (${n.detail})` : ''}`) });

  const transit = by('transit');
  if (transit.length) sections.push({ heading: 'Transit', items: transit.slice(0, 5).map((t) => `${t.title}${where(t) ? ` ${where(t)}` : ''}: ${t.detail}`) });

  const power = by('power');
  if (power.length) sections.push({ heading: 'Power', items: power.slice(0, 5).map((p) => `${p.detail} (${timeOf(p.at, tz)})`) });

  const crime = by('crime').sort((x, y) => y.severity - x.severity || y.at - x.at);
  if (crime.length) sections.push({ heading: 'Crime reports', items: crime.slice(0, 6).map((c) => `${c.title}: ${c.detail}`) });

  const hazards = [...by('storm'), ...by('quake'), ...by('flood'), ...by('air'), ...by('hotspot')].sort((x, y) => y.severity - x.severity);
  if (hazards.length) sections.push({ heading: 'Hazards', items: hazards.slice(0, 6).map((h) => `${h.title}${h.detail ? ` (${h.detail})` : ''}`) });

  const tfrs = by('tfr');
  if (tfrs.length) sections.push({ heading: 'No-fly zones', items: tfrs.map((t) => `${t.title}`) });

  const drones = by('drone');
  if (drones.length) sections.push({ heading: 'Drones', items: [`${plural(drones.length, 'drone')} detected nearby.`] });

  const parts = [
    clusters.length && plural(clusters.length, 'developing incident'),
    orbits.length && plural(orbits.length, 'circling aircraft'),
    traffic.length && plural(traffic.length, 'road incident'),
    transit.length && plural(transit.length, 'transit disruption'),
    power.length && plural(power.length, 'power outage report'),
    wx.length && plural(wx.length, 'weather alert'),
    news.length && plural(news.length, 'local safety story'),
    crime.length && plural(crime.length, 'violent crime report'),
    hazards.length && plural(hazards.length, 'hazard report'),
  ].filter(Boolean) as string[];
  const headline = parts.length ? `${args.packName}: ${parts.join(', ')}.` : `${args.packName}: quiet. Nothing notable in this period.`;

  const pushText = [headline, ...sections.slice(0, 3).map((s) => `${s.heading}: ${s.items[0]}`)].join('\n');
  return { packId: args.packId, generatedAt: Date.now(), from, to, headline, sections, pushText };
}
