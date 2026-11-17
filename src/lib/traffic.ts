import { distanceM, NM_TO_M, type LonLat } from './geo';
import { decodePolyline } from './polyline';
import type { Severity } from './signals';

export interface TrafficEvent {
  id: string;
  type: string; // accident, roadwork, closure, incident, ...
  title: string;
  description: string;
  roadway: string;
  location: LonLat;
  path: LonLat[] | null;
  fullClosure: boolean;
  severity: Severity;
  updated: number;
  provider: 'ga511' | 'cotrip';
}

export interface Camera {
  id: string;
  name: string;
  location: LonLat;
  imageUrl: string;
  roadway: string;
  direction: string;
  provider: 'ga511' | 'cotrip' | 'usgs';
  /** For webcams: the provider's page (attribution / full player). */
  pageUrl?: string;
}

const within = (p: LonLat, center: LonLat, radiusNm: number) => distanceM(p, center) <= radiusNm * NM_TO_M;

/** Planned roadwork is noise for a watch console; crashes and closures are not. */
export function trafficSeverity(type: string, fullClosure: boolean, desc: string): Severity {
  const t = `${type} ${desc}`.toLowerCase();
  if (/fatal|overturn|fire|hazmat|police activity|shooting/.test(t)) return 3;
  if (fullClosure || /accident|crash|collision|incident|disabled/.test(t)) return 2;
  if (/roadwork|construction|maintenance|planned/.test(t)) return 0;
  return 1;
}

// ---- Georgia 511 (https://511ga.org/developers/doc) ----

interface Ga511Event {
  ID: number | string;
  RoadwayName?: string;
  DirectionOfTravel?: string;
  Description?: string;
  EventType?: string;
  Subtype?: string;
  Latitude: number;
  Longitude: number;
  IsFullClosure?: boolean;
  LastUpdated?: number;
  Reported?: number;
  EncodedPolyline?: string;
}

interface Ga511Camera {
  Id: number | string;
  Name?: string;
  Location?: string;
  Roadway?: string;
  Direction?: string;
  Latitude: number;
  Longitude: number;
  Views?: { Url: string; Status?: string }[];
}

export const ga511Url = (what: 'event' | 'cameras', key: string) =>
  `https://511ga.org/api/v2/get/${what}?key=${encodeURIComponent(key)}&format=json`;

export function parseGa511Events(rows: Ga511Event[], center: LonLat, radiusNm: number): TrafficEvent[] {
  return rows
    .filter((r) => r.Latitude && r.Longitude && within([r.Longitude, r.Latitude], center, radiusNm))
    .map((r) => {
      const type = (r.EventType ?? 'incident').toLowerCase();
      const desc = r.Description ?? '';
      const path = r.EncodedPolyline ? decodePolyline(r.EncodedPolyline) : null;
      return {
        id: `ga511:${r.ID}`,
        type,
        title: `${(r.Subtype ?? type).replace(/^\w/, (c) => c.toUpperCase())}${r.RoadwayName ? ` · ${r.RoadwayName}` : ''}`,
        description: desc,
        roadway: r.RoadwayName ?? '',
        location: [r.Longitude, r.Latitude] as LonLat,
        path: path && path.length > 1 ? path : null,
        fullClosure: !!r.IsFullClosure,
        severity: trafficSeverity(type, !!r.IsFullClosure, desc),
        updated: ((r.LastUpdated ?? r.Reported ?? 0) as number) * 1000,
        provider: 'ga511' as const,
      };
    });
}

export function parseGa511Cameras(rows: Ga511Camera[], center: LonLat, radiusNm: number): Camera[] {
  return rows
    .filter((r) => r.Latitude && r.Longitude && within([r.Longitude, r.Latitude], center, radiusNm))
    .map((r) => {
      const view = r.Views?.find((v) => (v.Status ?? 'Enabled') === 'Enabled') ?? r.Views?.[0];
      return {
        id: `ga511:${r.Id}`,
        name: r.Location ?? r.Name ?? `Camera ${r.Id}`,
        location: [r.Longitude, r.Latitude] as LonLat,
        imageUrl: view?.Url ?? `https://511ga.org/map/Cctv/${r.Id}`,
        roadway: r.Roadway ?? '',
        direction: r.Direction ?? '',
        provider: 'ga511' as const,
      };
    })
    .filter((c) => c.imageUrl);
}

// ---- COtrip / CDOT (https://manage-api.cotrip.org) ----
// The response schema is not public without a key, so this parser is tolerant:
// it accepts a GeoJSON FeatureCollection (or a bare array of features) and
// reads common property names. Verify against a live response once you have a key.

export const cotripIncidentsUrl = (key: string) => `https://data.cotrip.org/api/v1/incidents?apiKey=${encodeURIComponent(key)}`;

type AnyProps = Record<string, unknown>;
const str = (p: AnyProps, ...keys: string[]) => {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

function firstPoint(g: GeoJSON.Geometry | null | undefined): LonLat | null {
  if (!g) return null;
  switch (g.type) {
    case 'Point':
      return g.coordinates as LonLat;
    case 'MultiPoint':
    case 'LineString':
      return (g.coordinates[0] as LonLat) ?? null;
    case 'MultiLineString':
    case 'Polygon':
      return (g.coordinates[0]?.[0] as LonLat) ?? null;
    default:
      return null;
  }
}

export function parseCotripIncidents(data: unknown, center: LonLat, radiusNm: number): TrafficEvent[] {
  const features: GeoJSON.Feature[] = Array.isArray(data)
    ? (data as GeoJSON.Feature[])
    : ((data as { features?: GeoJSON.Feature[] })?.features ?? []);
  const out: TrafficEvent[] = [];
  for (const f of features) {
    const p = (f.properties ?? {}) as AnyProps;
    const at = firstPoint(f.geometry);
    if (!at || !within(at, center, radiusNm)) continue;
    const type = str(p, 'type', 'eventType', 'incidentType', 'category').toLowerCase() || 'incident';
    const desc = str(p, 'travelerInformationMessage', 'description', 'message', 'headline');
    const closure = /closed|closure/i.test(`${type} ${desc} ${str(p, 'laneImpact', 'impact')}`);
    const path = f.geometry?.type === 'LineString' ? (f.geometry.coordinates as LonLat[]) : null;
    out.push({
      id: `cotrip:${str(p, 'id') || String(f.id ?? `${at[0]},${at[1]}`)}`,
      type,
      title: `${type.replace(/^\w/, (c) => c.toUpperCase())}${str(p, 'routeName', 'route', 'roadName') ? ` · ${str(p, 'routeName', 'route', 'roadName')}` : ''}`,
      description: desc,
      roadway: str(p, 'routeName', 'route', 'roadName'),
      location: at,
      path,
      fullClosure: closure,
      severity: trafficSeverity(type, closure, desc),
      updated: Date.parse(str(p, 'lastUpdated', 'updateTime', 'startTime')) || Date.now(),
      provider: 'cotrip',
    });
  }
  return out;
}

/** Cameras closest to a point, nearest first. */
export function nearestCameras(cameras: Camera[], at: LonLat, n = 4): Camera[] {
  return [...cameras].sort((a, b) => distanceM(a.location, at) - distanceM(b.location, at)).slice(0, n);
}
