import type { LonLat } from './geo';
import { assemblePack, buildPack, nearestBuiltin, reverseGeocode, type GeoResult } from './locate';
import type { CityPack } from './packs';

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

/** A watch area for ?city=lat,lon. Names it via the geocoder when reachable, otherwise works offline. */
export async function packForCoords(at: LonLat): Promise<CityPack> {
  const base = nearestBuiltin(at);
  const fallback: GeoResult = {
    name: base ? `${base.name} area` : `${at[1].toFixed(3)}, ${at[0].toFixed(3)}`,
    label: '',
    at,
    state: base?.power.state ?? '',
    county: '',
  };
  try {
    const g = await timeout(reverseGeocode(at), 5000);
    return await timeout(buildPack({ ...g, at }), 6000);
  } catch {
    return assemblePack(fallback, { timezone: base?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, nwsOffice: base?.nwsOffice ?? '', elevationFt: base?.fieldElevationFt ?? 0 });
  }
}
