import { distanceM, type LonLat } from './geo';
import { getJson } from './http';
import { PACKS, type CityPack } from './packs';

/**
 * Build a watch area for any US location. Generic sources (aircraft, NWS,
 * FAA, wildfires, power, news search, webcams) work anywhere; city-specific
 * ones (local news feeds, neighborhoods, radio, transit, traffic) are
 * inherited from a built-in city pack when the location is within ~60 km.
 */
export interface GeoResult {
  name: string; // short display name, e.g. "Boulder, CO"
  label: string; // full label from the geocoder
  at: LonLat;
  state: string; // full state name, e.g. "Colorado"
  county: string;
}

const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR',
};

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: { city?: string; town?: string; village?: string; hamlet?: string; suburb?: string; county?: string; state?: string; neighbourhood?: string };
}

function toResult(r: NominatimItem): GeoResult {
  const a = r.address ?? {};
  const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? r.name ?? r.display_name.split(',')[0];
  const st = a.state ?? '';
  return { name: `${place}${st ? `, ${STATE_ABBR[st] ?? st}` : ''}`, label: r.display_name, at: [Number(r.lon), Number(r.lat)], state: st, county: a.county ?? '' };
}

/**
 * Search OpenStreetMap's Nominatim (US only, since most sources are US).
 * Usage policy: one request per search (no autocomplete), identified client.
 */
export async function searchPlaces(q: string): Promise<GeoResult[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=us&q=${encodeURIComponent(q.trim())}`;
  return (await getJson<NominatimItem[]>(url)).map(toResult);
}

export async function reverseGeocode(at: LonLat): Promise<GeoResult> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=12&lat=${at[1].toFixed(5)}&lon=${at[0].toFixed(5)}`;
  return toResult(await getJson<NominatimItem>(url));
}

/** The browser/OS location, if the system allows it. */
export function deviceLocation(timeoutMs = 12_000): Promise<LonLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location services are not available on this system'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.code === 1 ? 'Location permission denied' : 'Could not determine your location')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60_000 },
    );
  });
}

const INHERIT_KM = 60;

export function nearestBuiltin(at: LonLat): CityPack | null {
  let best: { p: CityPack; d: number } | null = null;
  for (const p of PACKS) {
    const d = distanceM(at, p.center) / 1000;
    if (d <= INHERIT_KM && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

interface NwsPoint {
  properties?: { timeZone?: string; forecastGridData?: string; gridId?: string; relativeLocation?: { properties?: { city?: string; state?: string } } };
}

/** Assemble a city pack for a location. NWS supplies time zone, forecast office and elevation (US only). */
export async function buildPack(g: GeoResult): Promise<CityPack> {
  const [lon, lat] = g.at;
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let nwsOffice = '';
  let elevationFt = 0;
  try {
    const pt = await getJson<NwsPoint>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    timezone = pt.properties?.timeZone ?? timezone;
    nwsOffice = pt.properties?.gridId ?? '';
    if (pt.properties?.forecastGridData) {
      const grid = await getJson<{ properties?: { elevation?: { value?: number } } }>(pt.properties.forecastGridData).catch(() => null);
      elevationFt = Math.round((grid?.properties?.elevation?.value ?? 0) * 3.281);
    }
  } catch {
    /* outside NWS coverage: keep device time zone */
  }
  return assemblePack(g, { timezone, nwsOffice, elevationFt });
}

/** The offline part of buildPack: a pack from a place plus whatever NWS metadata is known. */
export function assemblePack(g: GeoResult, meta: { timezone: string; nwsOffice: string; elevationFt: number }): CityPack {
  const { timezone, nwsOffice, elevationFt } = meta;
  const [lon, lat] = g.at;
  const base = nearestBuiltin(g.at);
  const city = g.name.split(',')[0];
  const ab = STATE_ABBR[g.state] ?? '';
  return {
    id: `loc:${lat.toFixed(3)},${lon.toFixed(3)}`,
    name: city,
    region: ab || g.state,
    timezone,
    center: g.at,
    zoom: 10.2,
    radiusNm: 25,
    fieldElevationFt: base?.fieldElevationFt ?? elevationFt,
    nwsOffice: nwsOffice || base?.nwsOffice || '',
    radioFeeds: base?.radioFeeds ?? [{ name: `Scanner feeds in ${g.state || 'this state'}`, url: 'https://www.broadcastify.com/listen/', agency: 'Browse Broadcastify by state and county', coverage: null }],
    notes: base ? `Using ${base.name} local sources (nearby).` : 'Local news, radio and transit sources for this area are not set up yet; national sources are active.',
    traffic: base?.traffic ?? { provider: g.state === 'Georgia' ? 'ga511' : g.state === 'Colorado' ? 'cotrip' : 'none' },
    news: base
      ? { ...base.news, localTerms: [[city, lon, lat], ...base.news.localTerms] }
      : {
          feeds: [],
          googleQuery: `"${city}" ${ab} (police OR shooting OR fire OR crash OR arrested OR missing OR rescue OR SWAT) when:1d`,
          localTerms: [[city, lon, lat], ...(g.county ? [[g.county, lon, lat] as [string, number, number]] : [])],
        },
    liveTv: base?.liveTv ?? [],
    intel: base?.intel ?? { crime: null, s311: null, fbiOffice: null, airports: [] },
    places: base?.places ?? [],
    transit: base?.transit ?? null,
    power: { state: g.state || base?.power.state || '', utilities: base?.power.utilities ?? [] },
    custom: true,
  };
}
