import type { LonLat } from './geo';

/** Decode a Google encoded polyline (precision 5) to [lon, lat] pairs. */
export function decodePolyline(str: string, precision = 5): LonLat[] {
  const factor = 10 ** precision;
  const out: LonLat[] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}
