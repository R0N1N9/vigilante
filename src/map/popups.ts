import type { State } from '../data/store';
import { shipTypeName } from '../lib/intel';
import { MARK_CATEGORIES, markStateLabel } from '../lib/waypoints';

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

/** Layers that show a hover tooltip, topmost first. Polygons come last so points win. */
export const HOVERABLE = [
  'photos',
  'marks', 'waypoints', 'team', 'aircraft', 'drones', 'clusters', 'news', 'news-clusters', 'fires', 'traffic', 'transit', 'cameras',
  'crime-pts', 's311', 'hotspots', 'quakes', 'gauges', 'storms', 'ships', 'orbit-ring',
  'monitors-label', 'monitors-line', 'areas-label', 'radio-label', 'areas-line', 'radio-line', 'mark-areas-fill', 'outages-fill', 'tfr-fill', 'weather-fill',
];

const tip = (kind: string, title: string, detail = '', hint = '') =>
  `<small>${kind}</small><b>${title}</b>${detail ? `<p>${detail}</p>` : ''}${hint ? `<em>${hint}</em>` : ''}`;

/** Short hover tooltip for any map feature: what it is, and what clicking does. */
export function hoverHtml(layer: string, p: Record<string, unknown>, s: State, esc: (t: string) => string, radioName?: string): string | null {
  const id = String(p.id ?? '');
  const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60_000);
    return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  switch (layer) {
    case 'photos': {
      const ph = s.photos.find((x) => x.id === id);
      if (!ph) return null;
      return tip('PHOTO', esc(ph.cap || `Photo from ${ph.by}`), `by ${esc(ph.by)} ${ago(ph.at)}`, 'Click to view');
    }
    case 'marks':
    case 'mark-areas-fill': {
      const m = s.marks.find((x) => x.id === id);
      if (!m) return null;
      const head = m.kind === 'ping' ? 'PING' : m.kind === 'investigate' ? `INVESTIGATE · ${markStateLabel(m.kind, m.state).toUpperCase()}${m.state === 'progress' ? ` · ${esc(m.by).toUpperCase()}` : ''}` : m.kind === 'objective' ? `OBJECTIVE · ${m.state === 'progress' ? 'IN PROGRESS' : m.state.toUpperCase()}` : `${m.kind === 'area' ? 'AREA OF INTEREST' : 'MARKER'} · ${(MARK_CATEGORIES[m.cat] ?? '').toUpperCase()}`;
      return tip(head, esc(m.name), `${m.found ? `Found: ${esc(m.found.slice(0, 120))} · ` : m.desc ? `${esc(m.desc.slice(0, 120))} · ` : ''}by ${esc(m.by)} ${ago(m.at)}`, 'Click for details');
    }
    case 'waypoints': {
      const w = s.waypoints.find((x) => x.id === id);
      if (!w) return null;
      const acks = Object.values(w.acks);
      return tip(`WAYPOINT${w.priority === 'urgent' ? ' · URGENT' : ''} · ${w.state.toUpperCase()}`, esc(w.name), `${acks.filter((a) => a.state === 'arrived').length} arrived · ${acks.length} replied${w.note ? ` · ${esc(w.note.slice(0, 60))}` : ''}`, 'Click for agent status');
    }
    case 'team': {
      const m = s.team.find((x) => x.id === id);
      return m ? tip(`TEAMMATE · ${m.source === 'mesh' ? 'MESHTASTIC RADIO' : m.source === 'phone' ? (m.app === 'vigil' ? 'VIGIL APP' : 'PHONE CHECK-IN') : 'SHARED SPOT'}`, esc(m.name), [`Position ${ago(m.at)}`, m.accuracyM != null ? `±${m.accuracyM} m` : '', m.speedMs != null && m.speedMs > 0.5 ? `${Math.round(m.speedMs * 2.237)} mph` : '', m.activity && m.activity !== 'unknown' ? esc(m.activity) : '', m.heartRate ? `HR ${m.heartRate} bpm` : '', m.battery != null ? `battery ${m.battery}%${m.charging ? ' (charging)' : ''}` : ''].filter(Boolean).join(' · '), 'Click for profile and telemetry') : null;
    }
    case 'aircraft':
    case 'orbit-ring': {
      const a = s.aircraft.find((x) => x.hex === p.hex);
      if (!a) return null;
      const kind = a.emergency ? `EMERGENCY · SQUAWK ${esc(a.squawk)}` : a.kind === 'heli' ? 'HELICOPTER' : a.military ? 'MILITARY AIRCRAFT' : 'AIRCRAFT';
      const orbit = s.orbiting[a.hex] ? ' · CIRCLING' : '';
      return tip(`${kind}${orbit}`, esc(a.callsign || a.reg || a.hex.toUpperCase()), [a.desc || a.type, a.altFt != null && !a.onGround ? `${a.altFt.toLocaleString('en-US')} ft` : a.onGround ? 'on ground' : '', a.gsKt != null ? `${Math.round(a.gsKt)} kt` : ''].filter(Boolean).map((x) => esc(String(x))).join(' · '), 'Click for track and details');
    }
    case 'drones': {
      const d = s.drones.find((x) => x.id === id);
      if (!d) return null;
      const pilot = p.icon === 'pilot';
      return tip(pilot ? 'DRONE PILOT (REMOTE ID)' : `DRONE · REMOTE ID${d.simulated ? ' · SIMULATED' : ''}`, esc(d.uasId || d.selfId || 'Unknown drone'), pilot ? 'Reported operator position' : [d.heightM != null ? `${Math.round(d.heightM * 3.281)} ft AGL` : '', d.speedMs != null ? `${Math.round(d.speedMs * 2.237)} mph` : '', `seen ${ago(d.lastSeen)}`].filter(Boolean).join(' · '), 'Click to open drone list');
    }
    case 'clusters': {
      const c = s.clusters.find((x) => x.id === id);
      return c ? tip(`DEVELOPING INCIDENT · ${c.sources.length} SOURCES`, esc(c.title), `${c.signals.length} signals · last ${ago(c.lastAt)}`, 'Click for the timeline') : null;
    }
    case 'news': {
      const n = s.news.find((x) => x.id === id);
      return n ? tip(`NEWS · ${esc(n.source.toUpperCase())} · ${ago(n.published)}`, esc(n.title), n.precision === 'place' ? esc(n.areaName ?? '') : `≈ ${esc(n.areaName ?? '')} (approximate)`, 'Click to open the story') : null;
    }
    case 'news-clusters':
      return tip('NEWS', `${Number(p.point_count) || 0} local stories`, '', 'Click to zoom in');
    case 'fires': {
      const f = s.fires.find((x) => x.id === id);
      return f ? tip(f.kind === 'prescribed' ? 'PRESCRIBED BURN · NIFC' : 'WILDFIRE · NIFC', esc(f.name), [f.acres != null ? `${Math.round(f.acres).toLocaleString('en-US')} acres` : '', f.containedPct != null ? `${f.containedPct}% contained` : '', `${Math.round(f.distNm)} nm away`].filter(Boolean).join(' · '), 'Click for details') : null;
    }
    case 'traffic': {
      const t = s.traffic.find((x) => x.id === id);
      return t ? tip(`ROAD · ${esc(t.type.toUpperCase())}${t.fullClosure ? ' · FULL CLOSURE' : ''}`, esc(t.title), esc(t.roadway), 'Click for details') : null;
    }
    case 'transit': {
      const t = s.transit.find((x) => x.id === id);
      return t ? tip(`TRANSIT · ${t.agency}${t.cause ? ` · ${esc(t.cause.toUpperCase())}` : ''}`, esc(t.title), t.routes.length ? `Routes ${esc(t.routes.slice(0, 6).join(', '))}` : '', 'Click for details') : null;
    }
    case 'cameras': {
      const c = [...s.cameras, ...s.webcams].find((x) => x.id === id);
      return c ? tip(c.provider === 'usgs' ? 'USGS RIVER CAMERA' : 'TRAFFIC CAMERA', esc(c.name), esc([c.roadway, c.direction].filter(Boolean).join(' · ')), 'Click to view live image') : null;
    }
    case 'crime-pts': {
      const c = s.crimes.find((x) => x.id === id);
      return c ? tip(`CRIME REPORT · ${esc(c.category.toUpperCase())} · ${ago(c.at)}`, `${esc(c.offense)}${c.firearm ? ' · firearm' : ''}`, esc(c.neighborhood || c.address), 'Click for details') : null;
    }
    case 's311': {
      const r = s.requests311.find((x) => x.id === id);
      return r ? tip(`311 REQUEST · ${esc(r.status.toUpperCase())}`, esc(r.summary), esc(r.address), 'Click for details') : null;
    }
    case 'hotspots': {
      const h = s.hotspots.find((x) => x.id === id);
      return h ? tip('SATELLITE HEAT DETECTION · NASA FIRMS', `${h.frp.toFixed(1)} MW`, `${esc(h.satellite)} · ${ago(h.at)}`, 'Click for details') : null;
    }
    case 'quakes': {
      const q = s.quakes.find((x) => x.id === id);
      return q ? tip(`EARTHQUAKE · USGS · ${ago(q.at)}`, `M${q.mag.toFixed(1)}`, esc(q.place), 'Click for details') : null;
    }
    case 'gauges': {
      const g = s.gauges.find((x) => x.id === id);
      return g ? tip(`RIVER GAUGE · ${esc(g.category.replace('_', ' ').toUpperCase())}`, esc(g.name), g.stage != null ? `${g.stage} ${esc(g.unit)}` : '', 'Click for details') : null;
    }
    case 'storms': {
      const r = s.storms.find((x) => x.id === id);
      return r ? tip(`STORM REPORT · ${ago(r.at)}`, esc(r.type), esc(r.city), 'Click for details') : null;
    }
    case 'ships': {
      const v = s.ships.find((x) => x.mmsi === id);
      return v ? tip(`VESSEL · ${esc(shipTypeName(v.type).toUpperCase())}`, esc(v.name || 'Unnamed vessel'), v.sog != null ? `${v.sog.toFixed(1)} kn` : '', 'Click for details') : null;
    }
    case 'outages-fill': {
      const o = s.outages.find((x) => x.id === id);
      return o ? tip('POWER OUTAGE · DOE ODIN', `${esc(o.county)} County`, `${o.customers.toLocaleString('en-US')} customers out`, 'Click for utilities') : null;
    }
    case 'tfr-fill': {
      const t = s.tfrs.find((x) => x.id === id);
      return t ? tip(`FAA NO-FLY ZONE (TFR) · ${esc(t.type)}`, esc(t.title || t.id), `NOTAM ${esc(t.id)}`, 'Click for details') : null;
    }
    case 'weather-fill': {
      const a = s.alerts.find((x) => x.id === id);
      return a ? tip('NWS WEATHER ALERT', esc(a.event), a.expires ? `Until ${when(Date.parse(a.expires))}` : '', 'Click for details') : null;
    }
    case 'areas-fill':
    case 'areas-line':
    case 'areas-label':
      return tip('WATCH AREA', esc(String(p.name ?? 'Watch area')), 'Alerts inside are one step more urgent');
    case 'monitors-line':
    case 'monitors-label': {
      const m = s.monitors.find((x) => x.id === id);
      return m ? tip(`MONITOR · RADIUS ${(m.radiusM / 1609).toFixed(m.radiusM < 1609 ? 2 : 1)} MI${m.enabled ? '' : ' · OFF'}`, esc(m.name), 'Alerts on anything reported inside this ring', 'Edit in the Watch tab') : null;
    }
    case 'radio-fill':
    case 'radio-line':
    case 'radio-label':
      return radioName ? tip('SCANNER COVERAGE (APPROX.)', esc(radioName), '', 'Click to listen') : null;
  }
  return null;
}
