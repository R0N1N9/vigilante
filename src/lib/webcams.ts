import type { LonLat } from './geo';
import type { Camera } from './traffic';

/**
 * Windy Webcams API v3 (free key from api.windy.com). Public webcams near the
 * city: skylines, intersections, weather cams. Image URLs carry short-lived
 * tokens, so the list is refreshed every few minutes. Attribution required.
 */
export const windyUrl = (center: LonLat, radiusKm: number) =>
  `https://api.windy.com/webcams/api/v3/webcams?nearby=${center[1].toFixed(4)},${center[0].toFixed(4)},${Math.round(radiusKm)}&include=images,location,player,urls&limit=50`;

interface WindyCam {
  webcamId?: number | string;
  id?: number | string;
  title?: string;
  status?: string;
  location?: { latitude?: number; longitude?: number; city?: string };
  images?: { current?: { preview?: string; thumbnail?: string; icon?: string } };
  player?: { live?: string; day?: string };
  urls?: { detail?: string };
}

export function parseWindy(data: { webcams?: WindyCam[] }): Camera[] {
  return (data.webcams ?? [])
    .filter((w) => (w.status ?? 'active') === 'active' && w.location?.latitude != null && w.location?.longitude != null)
    .map((w) => ({
      id: `windy:${w.webcamId ?? w.id}`,
      name: w.title ?? 'Webcam',
      location: [w.location!.longitude!, w.location!.latitude!] as LonLat,
      imageUrl: w.images?.current?.preview ?? w.images?.current?.thumbnail ?? '',
      roadway: w.location?.city ?? '',
      direction: '',
      provider: 'windy' as const,
      pageUrl: w.urls?.detail ?? w.player?.live ?? w.player?.day,
    }))
    .filter((c) => c.imageUrl);
}
