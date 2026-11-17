import type { State } from '../data/store';
import { shipTypeName } from '../lib/intel';

/** Current NEXRAD base reflectivity mosaic tiles (Iowa Environmental Mesonet, keyless). */
export function radarTiles(): string {
  const bucket = Math.floor(Date.now() / 300_000); // new URL every 5 minutes
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?t=${bucket}`;
}

const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Popup HTML for the keyless intel layers. */
export function describeFeature(layer: string, id: string, s: State, esc: (t: string) => string): string | null | undefined {
  switch (layer) {
    case 'crime-pts': {
      const c = s.crimes.find((x) => x.id === id);
      return c && `<small>CRIME · ${esc(c.category.toUpperCase())} · ${when(c.at)}</small><b>${esc(c.offense)}${c.firearm ? ' · firearm' : ''}</b><p>${esc(c.address)}${c.neighborhood ? ` · ${esc(c.neighborhood)}` : ''}</p>`;
    }
    case 's311': {
      const r = s.requests311.find((x) => x.id === id);
      return r && `<small>311 · ${esc(r.status)} · ${when(r.at)}</small><b>${esc(r.summary)}</b><p>${esc(r.address)} · ${esc(r.agency)}</p>`;
    }
    case 'hotspots': {
      const h = s.hotspots.find((x) => x.id === id);
      return h && `<small>NASA FIRMS · SATELLITE HEAT DETECTION</small><b>${h.frp.toFixed(1)} MW fire radiative power</b><p>${esc(h.satellite)} ${h.day ? 'day' : 'night'} pass · ${when(h.at)} · confidence ${esc(h.confidence)}</p><p>Can be a wildfire, a controlled burn, or industrial heat (flares, plants).</p>`;
    }
    case 'quakes': {
      const q = s.quakes.find((x) => x.id === id);
      return q && `<small>USGS EARTHQUAKE · ${when(q.at)}</small><b>M${q.mag.toFixed(1)} ${esc(q.place)}</b><p>Depth ${q.depthKm.toFixed(1)} km · ${Math.round(q.distKm)} km from center</p>`;
    }
    case 'gauges': {
      const g = s.gauges.find((x) => x.id === id);
      return g && `<small>NOAA RIVER GAUGE · ${esc(g.category.replace('_', ' ').toUpperCase())}</small><b>${esc(g.name)}</b><p>${g.stage != null ? `${g.stage} ${esc(g.unit)}` : 'No current reading'}${g.forecastCategory && g.forecastCategory !== 'no_flooding' ? ` · forecast: ${esc(g.forecastCategory)}` : ''}</p>`;
    }
    case 'storms': {
      const r = s.storms.find((x) => x.id === id);
      return r && `<small>NWS STORM REPORT · ${esc(r.source)} · ${when(r.at)}</small><b>${esc(r.type)}${r.magnitude ? ` · ${esc(r.magnitude)} ${esc(r.unit)}` : ''}</b><p>${esc(r.city)}</p>${r.remark ? `<p>${esc(r.remark)}</p>` : ''}`;
    }
    case 'ships': {
      const v = s.ships.find((x) => x.mmsi === id);
      return v && `<small>AIS · ${esc(shipTypeName(v.type).toUpperCase())} · MMSI ${esc(v.mmsi)}</small><b>${esc(v.name || 'Unnamed vessel')}</b><p>${v.sog != null ? `${v.sog.toFixed(1)} kn` : ''}${v.cog != null ? ` · course ${Math.round(v.cog)}°` : ''} · ${when(v.at)}</p>`;
    }
  }
  return null;
}
