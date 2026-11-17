import { distanceM, NM_TO_M, type LonLat } from './geo';
import type { Severity } from './signals';

/**
 * Active wildland fire incidents from the National Interagency Fire Center
 * (WFIGS "Current Incident Locations", public ArcGIS layer).
 */
export interface FireIncident {
  id: string;
  name: string;
  kind: 'wildfire' | 'prescribed' | 'other';
  acres: number | null;
  containedPct: number | null;
  discovered: number | null;
  updated: number | null;
  county: string;
  cause: string;
  location: LonLat;
  distNm: number;
  severity: Severity;
}

export const WFIGS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

/** Query only a box around the city (degrees), so the response stays small. */
export function wfigsQuery(center: LonLat, radiusNm: number): string {
  const dLat = (radiusNm * NM_TO_M) / 111_000;
  const dLon = dLat / Math.cos((center[1] * Math.PI) / 180);
  const env = [center[0] - dLon, center[1] - dLat, center[0] + dLon, center[1] + dLat].map((n) => n.toFixed(4)).join(',');
  const q = new URLSearchParams({
    where: '1=1',
    geometry: env,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'IrwinID,IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,POOCounty,FireCause',
    outSR: '4326',
    f: 'geojson',
  });
  return `${WFIGS_URL}?${q}`;
}

interface WfigsProps {
  IrwinID?: string;
  IncidentName?: string;
  IncidentTypeCategory?: string; // WF wildfire, RX prescribed, CX complex
  IncidentSize?: number | null;
  PercentContained?: number | null;
  FireDiscoveryDateTime?: number | null;
  ModifiedOnDateTime_dt?: number | null;
  POOCounty?: string;
  FireCause?: string;
}

export function fireSeverity(kind: FireIncident['kind'], acres: number | null, contained: number | null, distNm: number): Severity {
  if (kind !== 'wildfire') return 0;
  if ((contained ?? 0) >= 100) return 0;
  const a = acres ?? 0;
  const near = distNm <= 15;
  if (a >= 1000 || (near && a >= 100)) return 3;
  if (a >= 100 || near) return 2;
  return 1;
}

export function parseWfigs(data: { features?: GeoJSON.Feature<GeoJSON.Point, WfigsProps>[] }, center: LonLat): FireIncident[] {
  return (data.features ?? [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => {
      const p = f.properties ?? {};
      const at = f.geometry.coordinates as LonLat;
      const kind: FireIncident['kind'] = p.IncidentTypeCategory === 'RX' ? 'prescribed' : p.IncidentTypeCategory === 'WF' || p.IncidentTypeCategory === 'CX' ? 'wildfire' : 'other';
      const distNm = distanceM(center, at) / NM_TO_M;
      const acres = p.IncidentSize ?? null;
      const contained = p.PercentContained ?? null;
      return {
        id: `wfigs:${p.IrwinID ?? `${at[0]},${at[1]}`}`,
        name: (p.IncidentName ?? 'Unnamed').replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()),
        kind,
        acres,
        containedPct: contained,
        discovered: p.FireDiscoveryDateTime ?? null,
        updated: p.ModifiedOnDateTime_dt ?? null,
        county: p.POOCounty ?? '',
        cause: p.FireCause ?? '',
        location: at,
        distNm,
        severity: fireSeverity(kind, acres, contained, distNm),
      };
    })
    .sort((a, b) => b.severity - a.severity || a.distNm - b.distNm);
}
