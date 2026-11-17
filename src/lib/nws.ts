import { destination, NM_TO_M, type LonLat } from './geo';

export type Severity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface NwsAlert {
  id: string;
  event: string;
  headline: string;
  severity: Severity;
  urgency: string;
  areaDesc: string;
  description: string;
  instruction: string;
  sent: string;
  onset: string | null;
  expires: string | null;
  senderName: string;
  geometry: GeoJSON.Geometry | null;
  affectedZones: string[];
}

interface NwsFeature {
  id: string;
  geometry: GeoJSON.Geometry | null;
  properties: {
    id: string;
    event: string;
    headline?: string | null;
    severity?: Severity;
    urgency?: string;
    areaDesc?: string;
    description?: string;
    instruction?: string | null;
    sent: string;
    onset?: string | null;
    ends?: string | null;
    expires?: string | null;
    senderName?: string;
    affectedZones?: string[];
  };
}

export interface NwsCollection {
  features: NwsFeature[];
}

/** Sample points across the AOI so alerts for outer zones are caught, not only the center. */
export function samplePoints(center: LonLat, radiusNm: number): LonLat[] {
  const r = radiusNm * NM_TO_M * 0.6;
  return [center, ...[0, 90, 180, 270].map((b) => destination(center, r, b))];
}

export function alertsUrl(p: LonLat): string {
  return `https://api.weather.gov/alerts/active?point=${p[1].toFixed(4)},${p[0].toFixed(4)}`;
}

export function parseAlerts(collections: NwsCollection[]): NwsAlert[] {
  const byId = new Map<string, NwsAlert>();
  for (const c of collections) {
    for (const f of c.features ?? []) {
      const p = f.properties;
      if (byId.has(p.id)) continue;
      byId.set(p.id, {
        id: p.id,
        event: p.event,
        headline: p.headline ?? p.event,
        severity: p.severity ?? 'Unknown',
        urgency: p.urgency ?? 'Unknown',
        areaDesc: p.areaDesc ?? '',
        description: p.description ?? '',
        instruction: p.instruction ?? '',
        sent: p.sent,
        onset: p.onset ?? null,
        expires: p.ends ?? p.expires ?? null,
        senderName: p.senderName ?? 'NWS',
        geometry: f.geometry,
        affectedZones: p.affectedZones ?? [],
      });
    }
  }
  return [...byId.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export function severityRank(s: Severity): number {
  return { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }[s] ?? 0;
}
