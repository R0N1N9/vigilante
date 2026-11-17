import { distanceM, NM_TO_M, type LonLat } from './geo';

/** Raw aircraft record from adsb.lol (ADSBExchange v2 compatible). */
export interface RawAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  lat?: number;
  lon?: number;
  seen?: number;
  seen_pos?: number;
  dbFlags?: number;
  ownOp?: string;
}

export type AircraftKind = 'heli' | 'fixed';
export type AircraftClass = 'emergency' | 'heli' | 'military' | 'low' | 'normal';

export interface Aircraft {
  hex: string;
  callsign: string;
  reg: string;
  type: string;
  desc: string;
  lat: number;
  lon: number;
  altFt: number | null; // barometric altitude, null when unknown
  onGround: boolean;
  aglFt: number | null; // rough: altitude minus the city's field elevation
  gsKt: number | null;
  track: number | null;
  vrateFpm: number | null;
  squawk: string;
  emergency: string | null;
  category: string;
  military: boolean;
  kind: AircraftKind;
  cls: AircraftClass;
  distNm: number;
  seenS: number;
}

/** ICAO type designators for common helicopters (backup for missing category A7). */
const HELI_TYPES = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B205', 'B212', 'B222', 'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H160', 'H125', 'AS32', 'AS50', 'AS55', 'AS65', 'AS3B',
  'A109', 'A119', 'A129', 'A139', 'A169', 'A189', 'AW09', 'BK17', 'S76', 'S92', 'S61', 'S70', 'H60', 'UH1', 'UH1Y',
  'H47', 'CH47', 'H64', 'MD52', 'MD60', 'MD90', 'EXPL', 'H269', 'S300', 'EN28', 'EN48', 'GAZL', 'LYNX', 'NH90',
]);

export const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'Hijack',
  '7600': 'Radio failure',
  '7700': 'General emergency',
};

export function isHelicopter(raw: Pick<RawAircraft, 'category' | 't'>): boolean {
  return raw.category === 'A7' || (raw.t != null && HELI_TYPES.has(raw.t.toUpperCase()));
}

export function emergencyOf(raw: Pick<RawAircraft, 'squawk' | 'emergency'>): string | null {
  if (raw.squawk && EMERGENCY_SQUAWKS[raw.squawk]) return EMERGENCY_SQUAWKS[raw.squawk];
  if (raw.emergency && raw.emergency !== 'none') return raw.emergency;
  return null;
}

export function normalizeAircraft(raw: RawAircraft, center: LonLat, fieldElevationFt: number): Aircraft | null {
  if (raw.lat == null || raw.lon == null) return null;
  const onGround = raw.alt_baro === 'ground';
  const altFt = typeof raw.alt_baro === 'number' ? raw.alt_baro : (raw.alt_geom ?? null);
  const aglFt = onGround ? 0 : altFt != null ? Math.max(0, altFt - fieldElevationFt) : null;
  const kind: AircraftKind = isHelicopter(raw) ? 'heli' : 'fixed';
  const emergency = emergencyOf(raw);
  const military = ((raw.dbFlags ?? 0) & 1) === 1;
  const cls: AircraftClass = emergency
    ? 'emergency'
    : kind === 'heli'
      ? 'heli'
      : military
        ? 'military'
        : aglFt != null && aglFt < 3000 && !onGround
          ? 'low'
          : 'normal';
  return {
    hex: raw.hex,
    callsign: (raw.flight ?? '').trim() || (raw.r ?? '').trim() || raw.hex.toUpperCase(),
    reg: (raw.r ?? '').trim(),
    type: (raw.t ?? '').trim(),
    desc: (raw.desc ?? raw.ownOp ?? '').trim(),
    lat: raw.lat,
    lon: raw.lon,
    altFt,
    onGround,
    aglFt,
    gsKt: raw.gs ?? null,
    track: raw.track ?? raw.true_heading ?? null,
    vrateFpm: raw.baro_rate ?? raw.geom_rate ?? null,
    squawk: raw.squawk ?? '',
    emergency,
    category: raw.category ?? '',
    military,
    kind,
    cls,
    distNm: distanceM(center, [raw.lon, raw.lat]) / NM_TO_M,
    seenS: raw.seen_pos ?? raw.seen ?? 0,
  };
}

export function adsbUrl(center: LonLat, radiusNm: number): string {
  const [lon, lat] = center;
  return `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(radiusNm)}`;
}

/** Ceiling filter: emergencies always pass; helicopters always pass (they are the point). */
export function passesCeiling(a: Aircraft, ceilingAglFt: number | null, hideGround: boolean): boolean {
  if (a.cls === 'emergency') return true;
  if (hideGround && a.onGround) return false;
  if (a.kind === 'heli') return true;
  if (ceilingAglFt == null) return true;
  return a.aglFt == null || a.aglFt <= ceilingAglFt;
}
