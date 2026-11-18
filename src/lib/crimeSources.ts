/**
 * City crime feeds on Socrata open-data portals. Each was checked against the live portal
 * (columns, freshness, coordinates) before being added. One adapter, configured per city.
 *
 * Portals publish with different delays (Chicago about a week, New York several weeks), so the
 * window is the 7 days up to the newest record, not the 7 days up to now; the UI says "as of".
 */
import { crimeSeverity, type Crime } from './intel';
import type { LonLat } from './geo';

export interface SocrataCrime {
  label: string;
  domain: string;
  dataset: string;
  /** Date column (floating timestamp, or text for Dallas), optional separate time column. */
  date: string;
  time?: string;
  /** Text-typed date column: compare as strings. */
  dateIsText?: boolean;
  type: string;
  desc?: string;
  addr?: string;
  hood?: string;
  /** Coordinates: lat/lon columns, or one Socrata location column. */
  lat?: string;
  lon?: string;
  geo?: string;
  /** Extra filter (SoQL). */
  where?: string;
  /** Rows per fetch; big cities need more for a full week. */
  limit?: number;
  mapUrl: string;
  lag: string;
}

export const SOCRATA_CRIME: Record<string, SocrataCrime> = {
  chicago: { label: 'Chicago Police (CLEAR) open data', domain: 'data.cityofchicago.org', dataset: 'ijzp-q8t2', limit: 6000, date: 'date', type: 'primary_type', desc: 'description', addr: 'block', lat: 'latitude', lon: 'longitude', mapUrl: 'https://data.cityofchicago.org/d/ijzp-q8t2', lag: 'published about a week behind' },
  'new-york': { label: 'NYPD complaint data, felonies', domain: 'data.cityofnewyork.us', dataset: '5uac-w243', where: "law_cat_cd = 'FELONY'", limit: 6000, date: 'cmplnt_fr_dt', time: 'cmplnt_fr_tm', type: 'ofns_desc', desc: 'pd_desc', addr: 'prem_typ_desc', hood: 'boro_nm', lat: 'latitude', lon: 'longitude', mapUrl: 'https://data.cityofnewyork.us/d/5uac-w243', lag: 'published several weeks behind' },
  'san-francisco': { label: 'SFPD incident reports', domain: 'data.sf.gov', dataset: 'wg3w-h783', date: 'incident_datetime', type: 'incident_category', desc: 'incident_description', addr: 'intersection', hood: 'analysis_neighborhood', lat: 'latitude', lon: 'longitude', mapUrl: 'https://data.sf.gov/d/wg3w-h783', lag: 'reports lag 1–2 days' },
  seattle: { label: 'Seattle Police crime data', domain: 'data.seattle.gov', dataset: 'tazs-3rd5', date: 'offense_date', type: 'offense_sub_category', desc: 'nibrs_offense_code_description', addr: 'block_address', hood: 'neighborhood', lat: 'latitude', lon: 'longitude', where: "latitude != 'REDACTED'", mapUrl: 'https://data.seattle.gov/d/tazs-3rd5', lag: 'reports lag 1–2 days; some locations withheld' },
  dallas: { label: 'Dallas Police incidents', domain: 'www.dallasopendata.com', dataset: 'qv6i-rri7', date: 'date1', time: 'time1', dateIsText: true, type: 'offincident', addr: 'incident_address', hood: 'division', geo: 'geocoded_column', mapUrl: 'https://www.dallasopendata.com/d/qv6i-rri7', lag: 'reports lag 1–2 days' },
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const q = (base: string, p: Record<string, string>) => `${base}?${new URLSearchParams(p).toString()}`;

/** Newest record date: the end of the window. */
export function socrataNewestUrl(s: SocrataCrime, now = Date.now()): string {
  const cap = s.dateIsText ? iso(now + 86_400_000).slice(0, 10) : iso(now + 86_400_000);
  return q(`https://${s.domain}/resource/${s.dataset}.json`, { $select: `max(${s.date}) as newest`, $where: `${s.date} < '${cap}'` });
}

/** The 7 days up to `newest`, newest first. */
export function socrataCrimeUrl(s: SocrataCrime, newestMs: number, limit = s.limit ?? 3000): string {
  const since = iso(newestMs - 7 * 86_400_000);
  const from = s.dateIsText ? since.slice(0, 10) : since;
  const cols = [s.date, s.time, s.type, s.desc, s.addr, s.hood, s.lat, s.lon, s.geo].filter(Boolean).join(',');
  const where = [`${s.date} >= '${from}'`, s.where].filter(Boolean).join(' AND ');
  return q(`https://${s.domain}/resource/${s.dataset}.json`, { $select: cols, $where: where, $order: `${s.date} DESC`, $limit: String(limit) });
}

/** "2026-11-17 00:00:00.0000000" + "03:08", or "2026-11-10T13:45:00.000": a city-local time read as the device's local time. */
export function socrataTime(date: unknown, time?: unknown): number {
  const d = String(date ?? '').replace(' ', 'T').replace(/(\.\d{3})\d+$/, '$1');
  if (!d) return 0;
  const day = d.slice(0, 10);
  const t = typeof time === 'string' && /^\d{1,2}:\d{2}/.test(time) ? time.padStart(5, '0') : d.slice(11, 19) || '00:00';
  return Date.parse(`${day}T${t.length === 5 ? `${t}:00` : t}`) || 0;
}

export const parseNewest = (rows: unknown): number => {
  const r = Array.isArray(rows) ? (rows[0] as { newest?: string } | undefined) : undefined;
  return r?.newest ? socrataTime(r.newest) : 0;
};

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();

export function parseSocrataCrime(id: string, s: SocrataCrime, rows: unknown): Crime[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r: Record<string, unknown>, i) => {
    let lat = Number(s.lat ? r[s.lat] : NaN);
    let lon = Number(s.lon ? r[s.lon] : NaN);
    if (s.geo && r[s.geo] && typeof r[s.geo] === 'object') {
      const g = r[s.geo] as { latitude?: string; longitude?: string; coordinates?: [number, number] };
      lat = Number(g.latitude ?? g.coordinates?.[1]);
      lon = Number(g.longitude ?? g.coordinates?.[0]);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !lon || Math.abs(lat) > 90) return [];
    const type = String(r[s.type] ?? '');
    const desc = s.desc ? String(r[s.desc] ?? '') : '';
    const at = socrataTime(r[s.date], s.time ? r[s.time] : undefined);
    if (!at) return [];
    const text = `${type} ${desc}`;
    const firearm = /\bgun|firearm|handgun|shoot|weapon/i.test(text);
    const location: LonLat = [lon, lat];
    return [
      {
        id: `${id}:${at}:${i}:${lat.toFixed(5)}`,
        offense: title(desc && desc.toLowerCase() !== type.toLowerCase() ? `${type}: ${desc}` : type),
        category: title(type),
        at,
        location,
        address: title(s.addr ? String(r[s.addr] ?? '') : ''),
        neighborhood: title(s.hood ? String(r[s.hood] ?? '') : ''),
        firearm,
        severity: crimeSeverity(text, firearm),
      },
    ];
  });
}
