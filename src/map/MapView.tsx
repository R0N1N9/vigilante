import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, subscribe, type State } from '../data/store';
import { passesCeiling } from '../lib/adsb';
import { circleRing, NM_TO_M, type LonLat } from '../lib/geo';
import { getPack } from '../lib/packs';
import { addIcons, CLASS_COLORS, DRONE_COLOR } from './icons';
import { LABEL_FONT, styleFor, tuneDarkStyle } from './styles';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

const SEVERITY_FILL = ['match', ['get', 'severity'], 'Extreme', '#FF4D4F', 'Severe', '#FF7A45', 'Moderate', '#FFB020', 'Minor', '#4C8DFF', '#8FA3B8'] as unknown as maplibregl.ExpressionSpecification;
const SEV_NUM = ['match', ['get', 'sev'], 4, '#FF4D4F', 3, '#FF7A45', 2, '#FFB020', 1, '#4C8DFF', '#8FA3B8'] as unknown as maplibregl.ExpressionSpecification;

const SOURCES = ['aoi', 'areas', 'draw', 'weather', 'tfr', 'traffic-lines', 'traffic', 'cameras', 'news', 'clusters', 'trails', 'orbits', 'drone-links', 'drones', 'aircraft'];

function addDataLayers(map: MlMap) {
  addIcons(map);
  for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  const L = (layer: maplibregl.LayerSpecification) => map.addLayer(layer);

  L({ id: 'weather-fill', type: 'fill', source: 'weather', paint: { 'fill-color': SEVERITY_FILL, 'fill-opacity': 0.12 } });
  L({ id: 'weather-line', type: 'line', source: 'weather', paint: { 'line-color': SEVERITY_FILL, 'line-width': 1.2, 'line-opacity': 0.7 } });
  L({ id: 'tfr-fill', type: 'fill', source: 'tfr', paint: { 'fill-color': '#FF4D4F', 'fill-opacity': 0.08 } });
  L({ id: 'tfr-line', type: 'line', source: 'tfr', paint: { 'line-color': '#FF4D4F', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
  L({ id: 'tfr-label', type: 'symbol', source: 'tfr', layout: { 'text-field': ['concat', 'TFR ', ['get', 'id']], 'text-font': LABEL_FONT, 'text-size': 11, 'symbol-placement': 'point' }, paint: { 'text-color': '#FF8A8C', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.4 } });
  L({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } });
  L({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.8 } });
  L({ id: 'areas-label', type: 'symbol', source: 'areas', layout: { 'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 12, 'symbol-placement': 'point' }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#3DD6F5', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [3, 3] } });
  L({ id: 'traffic-lines', type: 'line', source: 'traffic-lines', layout: { 'line-cap': 'round' }, paint: { 'line-color': SEV_NUM, 'line-width': 4, 'line-opacity': 0.55 } });
  L({ id: 'cameras', type: 'symbol', source: 'cameras', minzoom: 10, layout: { 'icon-image': 'camera', 'icon-size': 0.7, 'icon-allow-overlap': true } });
  L({ id: 'traffic', type: 'symbol', source: 'traffic', layout: { 'icon-image': ['concat', 'traffic-', ['to-string', ['get', 'sev']]], 'icon-size': 0.8, 'icon-allow-overlap': true } });
  L({ id: 'news', type: 'symbol', source: 'news', layout: { 'icon-image': ['concat', 'news-', ['to-string', ['get', 'sev']]], 'icon-size': 0.75, 'icon-allow-overlap': true } });
  L({ id: 'clusters', type: 'circle', source: 'clusters', paint: { 'circle-radius': 30, 'circle-color': 'rgba(255,77,79,0.06)', 'circle-stroke-color': SEV_NUM, 'circle-stroke-width': 2 } });
  L({ id: 'clusters-label', type: 'symbol', source: 'clusters', layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-offset': [0, 3.2], 'text-anchor': 'top' }, paint: { 'text-color': '#FFD1D1', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 2.2, 1.2], 'line-opacity': ['case', ['get', 'selected'], 0.95, 0.45] } });
  L({ id: 'orbit-ring', type: 'circle', source: 'orbits', paint: { 'circle-radius': 24, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#FFB020', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 } });
  L({ id: 'drone-links', type: 'line', source: 'drone-links', paint: { 'line-color': DRONE_COLOR, 'line-width': ['match', ['get', 'kind'], 'link', 1, 1.6], 'line-opacity': ['match', ['get', 'kind'], 'link', 0.6, 0.45], 'line-dasharray': [2, 2] } });
  L({ id: 'drones', type: 'symbol', source: 'drones', layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['match', ['get', 'icon'], 'pilot', 0.6, 0.85], 'icon-allow-overlap': true, 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': DRONE_COLOR, 'text-halo-color': '#0B0F14', 'text-halo-width': 1.4 } });
  L({
    id: 'aircraft',
    type: 'symbol',
    source: 'aircraft',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['case', ['get', 'selected'], 1.25, 1],
      'symbol-sort-key': ['get', 'z'],
      'text-field': ['step', ['zoom'], ['case', ['get', 'notable'], ['get', 'label'], ''], 10, ['get', 'label']],
      'text-font': LABEL_FONT,
      'text-size': 11,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(11,15,20,0.9)', 'text-halo-width': 1.4 },
  });
  L({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#3DD6F5', 'fill-opacity': 0.1 } });
  L({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#3DD6F5', 'line-width': 2, 'line-dasharray': [2, 1] } });
  L({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#3DD6F5', 'circle-stroke-color': '#0B0F14', 'circle-stroke-width': 2 } });
}

function setData(map: MlMap, id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function render(map: MlMap, s: State) {
  if (!map.getSource('aircraft')) return;
  const pack = getPack(s.packId);
  const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  vis(['aircraft', 'orbit-ring'], s.layers.aircraft);
  vis(['trails'], s.layers.trails && s.layers.aircraft);
  vis(['weather-fill', 'weather-line'], s.layers.weather);
  vis(['aoi-line'], s.layers.aoi);
  vis(['tfr-fill', 'tfr-line', 'tfr-label'], s.layers.tfr);
  vis(['traffic', 'traffic-lines'], s.layers.traffic);
  vis(['cameras'], s.layers.cameras);
  vis(['news'], s.layers.news);
  vis(['drones', 'drone-links'], s.layers.drones);
  vis(['areas-fill', 'areas-line', 'areas-label'], s.layers.areas);

  setData(map, 'aoi', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circleRing(pack.center, pack.radiusNm * NM_TO_M) } });
  setData(map, 'weather', fc(s.alerts.filter((a) => a.geometry).map((a) => ({ type: 'Feature', properties: { id: a.id, severity: a.severity }, geometry: a.geometry! }))));
  setData(map, 'tfr', fc(s.tfrs.map((t) => ({ type: 'Feature', properties: { id: t.id }, geometry: t.geometry }))));
  setData(map, 'areas', fc(s.areas.filter((a) => a.packId === s.packId && a.polygon.length >= 3).map((a) => ({ type: 'Feature', properties: { name: a.name, color: a.color }, geometry: { type: 'Polygon', coordinates: [[...a.polygon, a.polygon[0]]] } }))));
  setData(map, 'traffic', fc(s.traffic.map((t) => ({ type: 'Feature', properties: { id: t.id, sev: t.severity }, geometry: { type: 'Point', coordinates: t.location } }))));
  setData(map, 'traffic-lines', fc(s.traffic.filter((t) => t.path).map((t) => ({ type: 'Feature', properties: { sev: t.severity }, geometry: { type: 'LineString', coordinates: t.path! } }))));
  setData(map, 'cameras', fc(s.cameras.map((c) => ({ type: 'Feature', properties: { id: c.id }, geometry: { type: 'Point', coordinates: c.location } }))));
  setData(map, 'news', fc(s.news.filter((n) => n.location).map((n) => ({ type: 'Feature', properties: { id: n.id, sev: n.severity }, geometry: { type: 'Point', coordinates: n.location! } }))));
  setData(map, 'clusters', fc(s.clusters.map((c) => ({ type: 'Feature', properties: { id: c.id, sev: c.severity, label: `${c.title} · ${c.sources.length} sources` }, geometry: { type: 'Point', coordinates: c.center } }))));

  const droneFeatures: GeoJSON.Feature[] = [];
  const links: GeoJSON.Feature[] = [];
  for (const d of s.drones) {
    if (!d.location) continue;
    droneFeatures.push({ type: 'Feature', properties: { id: d.id, icon: 'drone', label: `${d.simulated ? 'SIM ' : ''}${d.heightM != null ? `${Math.round(d.heightM * 3.281)} ft` : ''}` }, geometry: { type: 'Point', coordinates: d.location } });
    if (d.trail.length > 1) links.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: d.trail } });
    if (d.operator) {
      droneFeatures.push({ type: 'Feature', properties: { id: d.id, icon: 'pilot', label: '' }, geometry: { type: 'Point', coordinates: d.operator } });
      links.push({ type: 'Feature', properties: { kind: 'link' }, geometry: { type: 'LineString', coordinates: [d.location, d.operator] } });
    }
  }
  setData(map, 'drones', fc(droneFeatures));
  setData(map, 'drone-links', fc(links));

  const shown = s.aircraft.filter((a) => passesCeiling(a, s.ceilingAglFt, s.hideGround));
  setData(
    map,
    'aircraft',
    fc(
      shown.map((a) => {
        const selected = a.hex === s.selectedHex;
        const cls = selected ? 'selected' : a.cls;
        return {
          type: 'Feature',
          properties: {
            hex: a.hex,
            icon: `ac-${a.kind === 'heli' ? 'heli' : 'plane'}-${cls}`,
            rot: a.kind === 'heli' ? 0 : (a.track ?? 0),
            color: CLASS_COLORS[cls],
            label: `${a.callsign}${a.altFt != null && !a.onGround ? ` ${Math.round(a.altFt / 100)}` : ''}`,
            notable: a.cls !== 'normal' || selected || s.orbiting[a.hex] != null,
            selected,
            z: selected ? 5 : { emergency: 4, heli: 3, military: 2, low: 1, normal: 0 }[a.cls],
          },
          geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        };
      }),
    ),
  );
  const shownHex = new Set(shown.map((a) => a.hex));
  const clsOf = new Map(s.aircraft.map((a) => [a.hex, a.cls]));
  setData(
    map,
    'trails',
    fc(
      Object.entries(s.trails)
        .filter(([hex, pts]) => shownHex.has(hex) && pts.length > 1)
        .map(([hex, pts]) => ({
          type: 'Feature',
          properties: { color: CLASS_COLORS[hex === s.selectedHex ? 'selected' : (clsOf.get(hex) ?? 'normal')], selected: hex === s.selectedHex },
          geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
        })),
    ),
  );
  setData(map, 'orbits', fc(Object.entries(s.orbiting).map(([hex, o]) => ({ type: 'Feature', properties: { hex }, geometry: { type: 'Point', coordinates: o.center } }))));

  // Watch-area drawing preview
  const d = s.drawing ?? [];
  const drawF: GeoJSON.Feature[] = d.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
  if (d.length >= 3) drawF.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...d, d[0]]] } });
  else if (d.length === 2) drawF.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d } });
  setData(map, 'draw', fc(drawF));
}

const CLICKABLE = ['aircraft', 'cameras', 'traffic', 'news', 'clusters', 'drones'];

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s0 = getState();
    const pack = getPack(s0.packId);
    const map = new maplibregl.Map({ container: el.current!, style: styleFor(s0.basemap), center: pack.center, zoom: pack.zoom, attributionControl: { compact: true }, fadeDuration: 0, doubleClickZoom: true });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    let ready = false;
    map.on('style.load', () => {
      if (getState().basemap === 'dark') tuneDarkStyle(map);
      addDataLayers(map);
      ready = true;
      render(map, getState());
    });
    // The dark style references fill patterns we don't ship; supply a blank one.
    map.on('styleimagemissing', (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '320px', className: 'vg-popup' });

    map.on('click', (e) => {
      const s = getState();
      if (s.drawing) {
        setState({ drawing: [...s.drawing, [e.lngLat.lng, e.lngLat.lat] as LonLat] });
        return;
      }
      const f = map.queryRenderedFeatures(e.point, { layers: CLICKABLE.filter((l) => map.getLayer(l)) })[0];
      if (!f) {
        setShared({ selectedHex: null });
        return;
      }
      const p = f.properties as Record<string, string>;
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      if (f.layer.id === 'aircraft') setShared({ selectedHex: p.hex });
      else if (f.layer.id === 'cameras') setState({ cameraId: p.id });
      else if (f.layer.id === 'traffic') {
        const t = s.traffic.find((x) => x.id === p.id);
        if (t) popup.setLngLat(t.location).setHTML(`<b>${esc(t.title)}</b><p>${esc(t.description)}</p>`).addTo(map);
      } else if (f.layer.id === 'news') {
        const n = s.news.find((x) => x.id === p.id);
        if (n) popup.setLngLat(n.location!).setHTML(`<small>${esc(n.source)} · ${esc(n.place ?? '')}</small><b>${esc(n.title)}</b>`).addTo(map);
      } else if (f.layer.id === 'clusters') {
        const c = s.clusters.find((x) => x.id === p.id);
        if (c) popup.setLngLat(c.center).setHTML(`<small>DEVELOPING · ${c.sources.join(', ')}</small>${c.signals.map((x) => `<p>${esc(x.title)}</p>`).join('')}`).addTo(map);
      } else if (f.layer.id === 'drones') setState({ tab: 'drones' });
    });
    map.on('dblclick', (e) => {
      const d = getState().drawing;
      if (d) e.preventDefault();
    });
    for (const l of CLICKABLE) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = getState().drawing ? 'crosshair' : ''));
    }

    let raf = 0;
    const pulse = (t: number) => {
      if (ready && map.getLayer('orbit-ring')) {
        const k = (t % 1600) / 1600;
        map.setPaintProperty('orbit-ring', 'circle-radius', 16 + 22 * k);
        map.setPaintProperty('orbit-ring', 'circle-stroke-opacity', 0.9 * (1 - k));
        const k2 = (t % 2400) / 2400;
        map.setPaintProperty('clusters', 'circle-radius', 26 + 16 * k2);
        map.setPaintProperty('clusters', 'circle-stroke-opacity', 1 - 0.7 * k2);
      }
      raf = requestAnimationFrame(pulse);
    };
    raf = requestAnimationFrame(pulse);

    let prev = s0;
    const unsub = subscribe(() => {
      const s = getState();
      if (s.basemap !== prev.basemap) {
        ready = false;
        map.setStyle(styleFor(s.basemap));
      }
      if (s.packId !== prev.packId) {
        const p = getPack(s.packId);
        map.jumpTo({ center: p.center, zoom: p.zoom });
      }
      if (s.focus && s.focus !== prev.focus) map.flyTo({ center: s.focus.center, zoom: s.focus.zoom ?? Math.max(map.getZoom(), 12), speed: 1.6 });
      if (s.drawing !== prev.drawing) map.getCanvas().style.cursor = s.drawing ? 'crosshair' : '';
      prev = s;
      if (ready) render(map, s);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);
    return () => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
      popup.remove();
      map.remove();
    };
  }, []);

  return <div ref={el} className="map" />;
}
