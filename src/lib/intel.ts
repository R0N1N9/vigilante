import { distanceM, NM_TO_M, type LonLat } from './geo';
import type { Severity } from './signals';
import type { Camera } from './traffic';

/**
 * Parsers for keyless public data sources. Each returns plain objects the
 * engine stores and the UI draws. Field names follow the live services
 * (verified Nov 2026).
 */

const within = (p: LonLat, c: LonLat, nm: number) => distanceM(p, c) <= nm * NM_TO_M;
const title = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------- Crime ---

export interface Crime {
  id: string;
  offense: string;
  category: string;
  at: number; // reported time, epoch ms
  location: LonLat;
  address: string;
  neighborhood: string;
  firearm: boolean;
  severity: Severity;
}

const VIOLENT = /homicide|murder|shoot|robbery|aggravated|agg-aslt|sexual|rape|kidnap|carjack|weapon|arson/i;
const PROPERTY = /burglary|auto-theft|motor vehicle theft|theft-from|stolen vehicle|larceny from motor|break/i;

export function crimeSeverity(text: string, firearm = false): Severity {
  if (/homicide|murder|shoot/i.test(text) || firearm) return 3;
  if (VIOLENT.test(text)) return 2;
  if (PROPERTY.test(text)) return 1;
  return 0;
}

/** ArcGIS date filter: SQL-92 timestamp literal accepted by hosted feature services. */
export function arcgisSince(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

export const DENVER_CRIME = 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324/query';
export const ATLANTA_CRIME = 'https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/OpenDataWebsite_Crime_view/FeatureServer/0/query';
export const DENVER_311 = 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_service_requests_311/FeatureServer/53/query';

export function arcgisQuery(base: string, where: string, fields: string, order: string, n = 2000): string {
  const q = new URLSearchParams({ where, outFields: fields, orderByFields: order, resultRecordCount: String(n), outSR: '4326', f: 'json' });
  return `${base}?${q}`;
}

type Attr = Record<string, unknown>;
interface EsriResponse {
  features?: { attributes: Attr; geometry?: { x?: number; y?: number } }[];
  error?: { message?: string };
}

function esriFeatures(d: EsriResponse) {
  if (d.error) throw new Error(d.error.message || 'ArcGIS error');
  return d.features ?? [];
}

export function parseDenverCrime(d: EsriResponse): Crime[] {
  return esriFeatures(d)
    .map((f) => {
      const a = f.attributes;
      const lon = Number(a.GEO_LON ?? f.geometry?.x);
      const lat = Number(a.GEO_LAT ?? f.geometry?.y);
      const type = String(a.OFFENSE_TYPE_ID ?? '');
      const cat = String(a.OFFENSE_CATEGORY_ID ?? '');
      return {
        id: `den:${a.OFFENSE_ID ?? a.OBJECTID}`,
        offense: title(type),
        category: title(cat),
        at: Number(a.REPORTED_DATE ?? a.FIRST_OCCURRENCE_DATE ?? 0),
        location: [lon, lat] as LonLat,
        address: String(a.INCIDENT_ADDRESS ?? ''),
        neighborhood: title(String(a.NEIGHBORHOOD_ID ?? '')),
        firearm: /shoot|gun|firearm/i.test(type),
        severity: crimeSeverity(`${type} ${cat}`),
      };
    })
    .filter((c) => c.location[0] && c.location[1] && Number(c.at) > 0);
}

export function parseAtlantaCrime(d: EsriResponse): Crime[] {
  return esriFeatures(d)
    .map((f) => {
      const a = f.attributes;
      const offense = String(a.NIBRS_Offense ?? '');
      const firearm = String(a.FireArmInvolved ?? '').toLowerCase() === 'yes';
      return {
        id: `atl:${a.ReportNumber ?? a.OBJECTID}`,
        offense,
        category: String(a.Crime_Against ?? a.Part ?? ''),
        at: Number(a.ReportDate ?? a.OccurredFromDate ?? 0),
        location: [Number(a.Longitude ?? f.geometry?.x), Number(a.Latitude ?? f.geometry?.y)] as LonLat,
        address: String(a.StreetAddress ?? ''),
        neighborhood: String(a.NhoodName ?? ''),
        firearm,
        severity: crimeSeverity(offense, firearm),
      };
    })
    .filter((c) => c.location[0] && c.location[1] && Number(c.at) > 0);
}

/** Counts by hour of day (local) for a "when does it happen" strip. */
export function hourHistogram(crimes: Crime[], tz: string): number[] {
  const h = new Array(24).fill(0);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
  for (const c of crimes) h[Number(fmt.format(c.at)) % 24]++;
  return h;
}

// ------------------------------------------------------------------ 311 ---

export interface ServiceRequest {
  id: string;
  summary: string;
  status: string;
  agency: string;
  at: number;
  location: LonLat;
  address: string;
  neighborhood: string;
}

export function parseDenver311(d: EsriResponse): ServiceRequest[] {
  return esriFeatures(d)
    .map((f) => {
      const a = f.attributes;
      return {
        id: `d311:${a.OBJECTID}`,
        summary: String(a.Case_Summary ?? 'Service request'),
        status: String(a.Case_Status ?? ''),
        agency: String(a.Agency ?? ''),
        at: Number(a.Case_Created_Date ?? 0),
        location: [Number(a.Longitude), Number(a.Latitude)] as LonLat,
        address: String(a.Incident_Address_1 ?? a.Incident_Intersection_1 ?? ''),
        neighborhood: String(a.Neighborhood ?? ''),
      };
    })
    .filter((r) => r.location[0] && r.location[1]);
}

// -------------------------------------------------- NASA FIRMS hotspots ---

export interface Hotspot {
  id: string;
  location: LonLat;
  at: number;
  satellite: string;
  confidence: string;
  frp: number; // fire radiative power, MW
  day: boolean;
}

/** Keyless public FIRMS CSVs (last 24 h, contiguous US + Hawaii). */
export const FIRMS_URLS = [
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv',
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_USA_contiguous_and_Hawaii_24h.csv',
];

export function parseFirms(csv: string, center: LonLat, radiusNm: number): Hotspot[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  const col = (n: string) => head.indexOf(n);
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp, iDn] = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'confidence', 'frp', 'daynight'].map(col);
  const out: Hotspot[] = [];
  for (const l of lines) {
    const c = l.split(',');
    const at: LonLat = [Number(c[iLon]), Number(c[iLat])];
    if (!within(at, center, radiusNm)) continue;
    const t = (c[iTime] ?? '0000').padStart(4, '0');
    const conf = c[iConf] ?? '';
    if (conf === 'l' || conf === 'low' || (/^\d+$/.test(conf) && Number(conf) < 30)) continue; // drop low-confidence detections
    out.push({
      id: `firms:${c[iSat]}:${c[iDate]}:${t}:${at[0].toFixed(3)},${at[1].toFixed(3)}`,
      location: at,
      at: Date.parse(`${c[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`),
      satellite: c[iSat] ?? '',
      confidence: conf,
      frp: Number(c[iFrp] ?? 0),
      day: c[iDn] === 'D',
    });
  }
  return out;
}

// ---------------------------------------------------------- Earthquakes ---

export interface Quake {
  id: string;
  mag: number;
  place: string;
  at: number;
  location: LonLat;
  depthKm: number;
  url: string;
  distKm: number;
}

export const QUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson';

export function parseQuakes(d: { features?: GeoJSON.Feature<GeoJSON.Point, { mag?: number; place?: string; time?: number; url?: string }>[] }, center: LonLat, radiusKm = 300): Quake[] {
  return (d.features ?? [])
    .map((f) => {
      const [lon, lat, depth] = f.geometry.coordinates;
      const at: LonLat = [lon, lat];
      return { id: `eq:${f.id}`, mag: f.properties.mag ?? 0, place: f.properties.place ?? '', at: f.properties.time ?? 0, location: at, depthKm: depth ?? 0, url: f.properties.url ?? '', distKm: distanceM(at, center) / 1000 };
    })
    .filter((q) => q.distKm <= radiusKm && q.mag >= 1.5)
    .sort((a, b) => b.at - a.at);
}

export const quakeSeverity = (q: Quake): Severity => (q.mag >= 5 ? 4 : q.mag >= 4 ? 3 : q.mag >= 3 && q.distKm < 150 ? 2 : q.mag >= 2.5 ? 1 : 0);

// ----------------------------------------------------------- FBI Wanted ---

/** wanted: fugitives · missing: kidnapped or missing people · info: FBI seeking information about a crime or person. */
export type PosterKind = 'wanted' | 'missing' | 'info';

export interface Wanted {
  id: string;
  title: string;
  classification: string;
  kind: PosterKind;
  /** Poster header, e.g. "WANTED", "MISSING", "SEEKING INFORMATION", "TEN MOST WANTED". */
  label: string;
  subjects: string[];
  reward: string;
  caution: string;
  /** e.g. "SHOULD BE CONSIDERED ARMED AND DANGEROUS". */
  warning: string;
  image: string | null;
  imageLarge: string | null;
  /** Official printable poster (PDF). */
  pdf: string | null;
  url: string;
  published: number;
  modified: number;
  /** Case summary (date and place) and details, as plain text. */
  summary: string;
  details: string;
  remarks: string;
  /** Physical description as published on the poster. */
  sex: string;
  race: string;
  hair: string;
  eyes: string;
  height: string;
  weight: string;
  dob: string[];
  aliases: string[];
  placeOfBirth: string;
}

const POSTER_LABEL: Record<string, string> = {
  missing: 'MISSING',
  information: 'SEEKING INFORMATION',
  ten: 'TEN MOST WANTED',
  'crimes-against-children': 'WANTED · CRIMES AGAINST CHILDREN',
  terrorist: 'MOST WANTED TERRORIST',
  fraudster: 'WANTED · FRAUD',
  'law-enforcement-assistance': 'LAW ENFORCEMENT ASSISTANCE',
  default: 'WANTED',
};

const posterKind = (c: string): PosterKind => (c === 'missing' ? 'missing' : c === 'information' || c === 'law-enforcement-assistance' ? 'info' : 'wanted');

/** Inches → 5'6" (a range when min and max differ). */
function feetInches(min: unknown, max: unknown): string {
  const f = (n: number) => `${Math.floor(n / 12)}'${n % 12}"`;
  const a = Number(min);
  const b = Number(max);
  if (!a && !b) return '';
  if (a && b && a !== b) return `${f(a)} to ${f(b)}`;
  return f(a || b);
}

export const fbiUrl = (office: string) => `https://api.fbi.gov/wanted/v1/list?field_offices=${encodeURIComponent(office)}&pageSize=50`;

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseWanted(d: { items?: Record<string, unknown>[] }): Wanted[] {
  const str = (v: unknown) => (v == null ? '' : strip(String(v)));
  const fbiOnly = (u: unknown) => (typeof u === 'string' && /^https:\/\/(www\.)?fbi\.gov\//.test(u) ? u : null);
  return (d.items ?? []).map((i) => {
    const classification = String(i.poster_classification ?? 'default');
    const img = ((i.images as { thumb?: string; large?: string; original?: string }[] | null) ?? [])[0];
    const pdf = ((i.files as { url?: string; name?: string }[] | null) ?? []).find((f) => /english/i.test(f.name ?? '')) ?? ((i.files as { url?: string }[] | null) ?? [])[0];
    return {
      id: `fbi:${i.uid}`,
      title: String(i.title ?? '').replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
      classification,
      kind: posterKind(classification),
      label: POSTER_LABEL[classification] ?? 'WANTED',
      subjects: (i.subjects as string[] | null) ?? [],
      reward: str(i.reward_text),
      caution: str(i.caution ?? i.description).slice(0, 300),
      warning: str(i.warning_message),
      image: fbiOnly(img?.thumb),
      imageLarge: fbiOnly(img?.large ?? img?.original),
      pdf: fbiOnly(pdf?.url),
      url: String(i.url ?? ''),
      published: Date.parse(String(i.publication ?? '')) || 0,
      modified: Date.parse(String(i.modified ?? '')) || 0,
      summary: str(i.description),
      details: str(i.details).slice(0, 1500),
      remarks: str(i.remarks).slice(0, 600),
      sex: str(i.sex),
      race: str(i.race_raw ?? i.race),
      hair: str(i.hair_raw ?? i.hair),
      eyes: str(i.eyes_raw ?? i.eyes),
      height: feetInches(i.height_min, i.height_max),
      weight: str(i.weight),
      dob: ((i.dates_of_birth_used as string[] | null) ?? []).map(String),
      aliases: ((i.aliases as string[] | null) ?? []).map(String),
      placeOfBirth: str(i.place_of_birth),
    };
  });
}

// ------------------------------------------------------- River gauges ---

export interface Gauge {
  id: string;
  name: string;
  location: LonLat;
  category: 'no_flooding' | 'action' | 'minor' | 'moderate' | 'major' | 'unknown';
  stage: number | null;
  unit: string;
  forecastCategory: string;
  url: string;
}

export function nwpsUrl(center: LonLat, radiusNm: number): string {
  const d = (radiusNm * NM_TO_M) / 111_000;
  const dl = d / Math.cos((center[1] * Math.PI) / 180);
  return `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${(center[0] - dl).toFixed(3)}&bbox.ymin=${(center[1] - d).toFixed(3)}&bbox.xmax=${(center[0] + dl).toFixed(3)}&bbox.ymax=${(center[1] + d).toFixed(3)}&srid=EPSG_4326`;
}

const CATS = ['no_flooding', 'action', 'minor', 'moderate', 'major'] as const;

export function parseGauges(d: { gauges?: Record<string, any>[] }): Gauge[] {
  return (d.gauges ?? []).map((g) => {
    const obs = g.status?.observed ?? {};
    const cat = String(obs.floodCategory ?? 'unknown');
    return {
      id: `nwps:${g.lid}`,
      name: String(g.name ?? g.lid),
      location: [Number(g.longitude), Number(g.latitude)] as LonLat,
      category: (CATS as readonly string[]).includes(cat) ? (cat as Gauge['category']) : 'unknown',
      stage: obs.primary != null && obs.primary > -999 ? Number(obs.primary) : null,
      unit: String(obs.primaryUnit ?? ''),
      forecastCategory: String(g.status?.forecast?.floodCategory ?? ''),
      url: `https://water.noaa.gov/gauges/${String(g.lid).toLowerCase()}`,
    };
  });
}

export const gaugeSeverity = (g: Gauge): Severity => ({ no_flooding: 0, unknown: 0, action: 1, minor: 2, moderate: 3, major: 4 } as const)[g.category];

// --------------------------------------------------------- Air quality ---

export interface AirQuality {
  aqi: number;
  pm25: number;
  ozone: number;
  at: number;
  label: string;
}

export const airUrl = (c: LonLat) => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c[1].toFixed(3)}&longitude=${c[0].toFixed(3)}&current=us_aqi,pm2_5,ozone`;

/** Readings at several points in one request (Open-Meteo answers with an array, in the same order). */
export const airPointsUrl = (pts: LonLat[]) =>
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${pts.map((p) => p[1].toFixed(3)).join(',')}&longitude=${pts.map((p) => p[0].toFixed(3)).join(',')}&current=us_aqi,pm2_5,ozone`;

export interface AirPoint {
  id: string;
  name: string;
  at: LonLat;
  air: AirQuality;
}

/** Center plus four points halfway to the edge of the watch area (N, E, S, W). */
export function airSamplePoints(center: LonLat, radiusM: number): { name: string; at: LonLat }[] {
  const d = radiusM / 2;
  const dLat = d / 111_320;
  const dLon = d / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [
    { name: 'Center', at: center },
    { name: 'North', at: [center[0], center[1] + dLat] },
    { name: 'East', at: [center[0] + dLon, center[1]] },
    { name: 'South', at: [center[0], center[1] - dLat] },
    { name: 'West', at: [center[0] - dLon, center[1]] },
  ];
}

export function parseAirPoints(d: unknown, pts: { name: string; at: LonLat }[]): AirPoint[] {
  const arr = Array.isArray(d) ? d : [d];
  return arr.flatMap((x, i) => {
    const air = parseAir(x as Parameters<typeof parseAir>[0]);
    const p = pts[i];
    return air && p ? [{ id: `air:${i}`, name: p.name, at: p.at, air }] : [];
  });
}

export const AIRNOW_URL = 'https://www.airnow.gov/';

export function aqiLabel(aqi: number): string {
  return aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for sensitive groups' : aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
}

export function parseAir(d: { current?: { us_aqi?: number; pm2_5?: number; ozone?: number; time?: string } }): AirQuality | null {
  const c = d.current;
  if (!c || c.us_aqi == null) return null;
  return { aqi: c.us_aqi, pm25: c.pm2_5 ?? 0, ozone: c.ozone ?? 0, at: Date.parse(`${c.time}Z`) || Date.now(), label: aqiLabel(c.us_aqi) };
}

export const airSeverity = (a: AirQuality): Severity => (a.aqi > 200 ? 3 : a.aqi > 150 ? 2 : a.aqi > 100 ? 1 : 0);

// ------------------------------------------------------- Airport status ---

export interface AirportDelay {
  airport: string;
  kind: string; // Ground stop, Ground delay, Arrival/departure delay, Closure
  reason: string;
  detail: string;
}

export const FAA_STATUS_URL = 'https://nasstatus.faa.gov/api/airport-status-information';

export function parseAirportStatus(xml: string, airports: string[], parser = new DOMParser()): AirportDelay[] {
  const doc = parser.parseFromString(xml, 'text/xml');
  const want = new Set(airports.map((a) => a.toUpperCase()));
  const out: AirportDelay[] = [];
  const txt = (el: Element, sel: string) => el.getElementsByTagName(sel)[0]?.textContent?.trim() ?? '';
  for (const g of Array.from(doc.getElementsByTagName('Ground_Delay')))
    out.push({ airport: txt(g, 'ARPT'), kind: 'Ground delay program', reason: txt(g, 'Reason'), detail: `Avg ${txt(g, 'Avg')}, max ${txt(g, 'Max')}` });
  for (const g of Array.from(doc.getElementsByTagName('Program')))
    out.push({ airport: txt(g, 'ARPT'), kind: 'Ground stop', reason: txt(g, 'Reason'), detail: txt(g, 'End_Time') ? `Until ${txt(g, 'End_Time')}` : '' });
  for (const g of Array.from(doc.getElementsByTagName('Delay')))
    out.push({ airport: txt(g, 'ARPT'), kind: `${txt(g, 'Arrival_Departure') || 'Arrival/departure'} delay`.replace(/^(\w)/, (m) => m.toUpperCase()), reason: txt(g, 'Reason'), detail: [txt(g, 'Min'), txt(g, 'Max')].filter(Boolean).join(' – ') });
  for (const g of Array.from(doc.getElementsByTagName('Airport')).filter((a) => a.getElementsByTagName('Start').length))
    out.push({ airport: txt(g, 'ARPT'), kind: 'Closure', reason: txt(g, 'Reason'), detail: `${txt(g, 'Start')} – ${txt(g, 'Reopen')}` });
  return out.filter((d) => d.airport && want.has(d.airport.toUpperCase()));
}

// ------------------------------------------------ NWS local storm reports ---

export interface StormReport {
  id: string;
  type: string;
  magnitude: string;
  unit: string;
  city: string;
  remark: string;
  at: number;
  location: LonLat;
  source: string;
}

export const lsrUrl = (state: string, hours = 24) => `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?states=${state}&hours=${hours}`;

export function parseLsr(d: { features?: { properties: Record<string, unknown> }[] }, center: LonLat, radiusNm: number): StormReport[] {
  return (d.features ?? [])
    .map((f) => {
      const p = f.properties;
      const at: LonLat = [Number(p.lon), Number(p.lat)];
      return {
        id: `lsr:${p.product_id}:${p.lon},${p.lat}:${p.typetext}`,
        type: title(String(p.typetext ?? 'Report').toLowerCase()),
        magnitude: String(p.magnitude ?? ''),
        unit: String(p.unit ?? ''),
        city: String(p.city ?? ''),
        remark: String(p.remark ?? ''),
        at: Date.parse(String(p.valid ?? '')) || 0,
        location: at,
        source: String(p.source ?? ''),
      };
    })
    .filter((r) => within(r.location, center, radiusNm))
    .sort((a, b) => b.at - a.at);
}

export function stormSeverity(r: StormReport): Severity {
  const t = r.type.toLowerCase();
  if (/tornado/.test(t)) return 4;
  if (/flash flood|funnel|wildfire|blizzard/.test(t)) return 3;
  if (/hail|tstm wnd dmg|non-tstm wnd dmg|flood|ice storm|heavy snow/.test(t)) return 2;
  return 1;
}

// ------------------------------------------------ USGS river cameras ---

export const USGS_CAMS_URL = 'https://api.waterdata.usgs.gov/nims/v0/cameras';

interface NimsCam {
  camId: string;
  camName?: string;
  camDesc?: string;
  lat: string;
  lng: string;
  hideCam?: boolean;
  newestImageDT?: string;
  smallDir?: string;
}

/** Image name: {camId}___{newest UTC time with ':' -> '-'}Z.jpg in the 720px folder. */
export function usgsImageUrl(c: NimsCam): string | null {
  if (!c.smallDir || !c.newestImageDT) return null;
  const t = c.newestImageDT.replace(/\.\d+Z$/, '').replace(/:/g, '-');
  return `${c.smallDir}${c.camId}___${t}Z.jpg`;
}

export function parseUsgsCams(list: NimsCam[], center: LonLat, radiusNm: number, maxAgeMs = 24 * 3600_000): Camera[] {
  const now = Date.now();
  return list
    .filter((c) => !c.hideCam && within([Number(c.lng), Number(c.lat)], center, radiusNm) && now - Date.parse(c.newestImageDT ?? '') < maxAgeMs)
    .map((c) => ({
      id: `usgs:${c.camId}`,
      name: c.camName ?? c.camId,
      location: [Number(c.lng), Number(c.lat)] as LonLat,
      imageUrl: usgsImageUrl(c) ?? '',
      roadway: 'USGS river camera',
      direction: '',
      provider: 'usgs' as const,
      pageUrl: `https://apps.usgs.gov/hivis/camera/${c.camId}`,
    }))
    .filter((c) => c.imageUrl);
}

// ----------------------------------------------------------- AIS ships ---

export interface Ship {
  mmsi: string;
  name: string;
  location: LonLat;
  sog: number | null; // knots
  cog: number | null;
  heading: number | null;
  type: number | null;
  status: number | null;
  at: number;
}

export const SHIP_TYPES: [number, number, string][] = [
  [30, 30, 'Fishing'], [31, 32, 'Towing'], [35, 35, 'Military'], [36, 36, 'Sailing'], [37, 37, 'Pleasure craft'], [50, 50, 'Pilot'], [51, 51, 'Search & rescue'],
  [52, 52, 'Tug'], [55, 55, 'Law enforcement'], [58, 58, 'Medical'], [60, 69, 'Passenger'], [70, 79, 'Cargo'], [80, 89, 'Tanker'],
];

export const shipTypeName = (t: number | null) => (t == null ? 'Vessel' : (SHIP_TYPES.find(([a, b]) => t >= a && t <= b)?.[2] ?? 'Vessel'));

/** Merge one AISstream.io JSON message into the ship table. */
export function applyAis(ships: Map<string, Ship>, raw: string): Ship | null {
  let m: { MessageType?: string; MetaData?: Record<string, any>; Message?: Record<string, any> };
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  const md = m.MetaData ?? {};
  const mmsi = String(md.MMSI ?? md.MMSI_String ?? '');
  if (!mmsi) return null;
  const s: Ship = ships.get(mmsi) ?? { mmsi, name: '', location: [md.longitude, md.latitude], sog: null, cog: null, heading: null, type: null, status: null, at: 0 };
  s.name = String(md.ShipName ?? s.name).trim();
  if (md.longitude != null && md.latitude != null) s.location = [Number(md.longitude), Number(md.latitude)];
  s.at = Date.parse(String(md.time_utc ?? '').replace(' +0000 UTC', 'Z').replace(' ', 'T')) || Date.now();
  const body = m.Message?.[m.MessageType ?? ''] ?? {};
  if (m.MessageType === 'PositionReport' || m.MessageType === 'StandardClassBPositionReport') {
    s.sog = body.Sog ?? s.sog;
    s.cog = body.Cog ?? s.cog;
    s.heading = body.TrueHeading != null && body.TrueHeading < 360 ? body.TrueHeading : s.heading;
    s.status = body.NavigationalStatus ?? s.status;
  } else if (m.MessageType === 'ShipStaticData') {
    s.type = body.Type ?? s.type;
    if (body.Name) s.name = String(body.Name).trim();
  }
  ships.set(mmsi, s);
  return s;
}
