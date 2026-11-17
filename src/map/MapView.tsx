import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { setShared } from '../data/bus';
import { getState, subscribe, type State } from '../data/store';
import { passesCeiling } from '../lib/adsb';
import { circleRing, NM_TO_M } from '../lib/geo';
import { getPack } from '../lib/packs';
import { addAircraftIcons, CLASS_COLORS } from './icons';
import { LABEL_FONT, styleFor, tuneDarkStyle } from './styles';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const SEVERITY_FILL = [
  'match',
  ['get', 'severity'],
  'Extreme', '#FF4D4F',
  'Severe', '#FF7A45',
  'Moderate', '#FFB020',
  'Minor', '#4C8DFF',
  '#8FA3B8',
] as unknown as maplibregl.ExpressionSpecification;

function addDataLayers(map: MlMap) {
  addAircraftIcons(map);
  for (const id of ['aoi', 'weather', 'trails', 'orbits', 'aircraft']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  map.addLayer({ id: 'weather-fill', type: 'fill', source: 'weather', paint: { 'fill-color': SEVERITY_FILL, 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'weather-line', type: 'line', source: 'weather', paint: { 'line-color': SEVERITY_FILL, 'line-width': 1.2, 'line-opacity': 0.7 } });
  map.addLayer({
    id: 'aoi-line',
    type: 'line',
    source: 'aoi',
    paint: { 'line-color': '#3DD6F5', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [3, 3] },
  });
  map.addLayer({
    id: 'trails',
    type: 'line',
    source: 'trails',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 2.2, 1.2], 'line-opacity': ['case', ['get', 'selected'], 0.95, 0.45] },
  });
  map.addLayer({
    id: 'orbit-ring',
    type: 'circle',
    source: 'orbits',
    paint: { 'circle-radius': 24, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#FFB020', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 },
  });
  map.addLayer({
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
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': 'rgba(11,15,20,0.9)',
      'text-halo-width': 1.4,
    },
  });
}

function render(map: MlMap, s: State) {
  if (!map.getSource('aircraft')) return;
  const pack = getPack(s.packId);
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('aircraft', s.layers.aircraft);
  vis('orbit-ring', s.layers.aircraft);
  vis('trails', s.layers.trails && s.layers.aircraft);
  vis('weather-fill', s.layers.weather);
  vis('weather-line', s.layers.weather);
  vis('aoi-line', s.layers.aoi);

  (map.getSource('aoi') as GeoJSONSource).setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: circleRing(pack.center, pack.radiusNm * NM_TO_M) },
  });

  (map.getSource('weather') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: s.alerts
      .filter((a) => a.geometry)
      .map((a) => ({ type: 'Feature', properties: { id: a.id, severity: a.severity, event: a.event }, geometry: a.geometry! })),
  });

  const shown = s.aircraft.filter((a) => passesCeiling(a, s.ceilingAglFt, s.hideGround));
  (map.getSource('aircraft') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: shown.map((a) => {
      const selected = a.hex === s.selectedHex;
      const cls = selected ? 'selected' : a.cls;
      const notable = a.cls !== 'normal' || selected || s.orbiting[a.hex] != null;
      return {
        type: 'Feature',
        properties: {
          hex: a.hex,
          icon: `ac-${a.kind === 'heli' ? 'heli' : 'plane'}-${cls}`,
          rot: a.kind === 'heli' ? 0 : (a.track ?? 0),
          color: CLASS_COLORS[cls],
          label: `${a.callsign}${a.altFt != null && !a.onGround ? ` ${Math.round(a.altFt / 100)}` : ''}`,
          notable,
          selected,
          z: selected ? 5 : { emergency: 4, heli: 3, military: 2, low: 1, normal: 0 }[a.cls],
        },
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      };
    }),
  });

  const shownHex = new Set(shown.map((a) => a.hex));
  const clsOf = new Map(s.aircraft.map((a) => [a.hex, a.cls]));
  (map.getSource('trails') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: Object.entries(s.trails)
      .filter(([hex, pts]) => shownHex.has(hex) && pts.length > 1)
      .map(([hex, pts]) => {
        const selected = hex === s.selectedHex;
        return {
          type: 'Feature',
          properties: { color: CLASS_COLORS[selected ? 'selected' : (clsOf.get(hex) ?? 'normal')], selected },
          geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
        };
      }),
  });

  (map.getSource('orbits') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: Object.entries(s.orbiting).map(([hex, o]) => ({
      type: 'Feature',
      properties: { hex },
      geometry: { type: 'Point', coordinates: o.center },
    })),
  });
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s0 = getState();
    const pack = getPack(s0.packId);
    const map = new maplibregl.Map({
      container: el.current!,
      style: styleFor(s0.basemap),
      center: pack.center,
      zoom: pack.zoom,
      attributionControl: { compact: true },
      fadeDuration: 0,
    });
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

    map.on('click', 'aircraft', (e) => {
      const hex = e.features?.[0]?.properties?.hex as string | undefined;
      if (hex) setShared({ selectedHex: hex });
    });
    map.on('click', (e) => {
      if (!map.queryRenderedFeatures(e.point, { layers: ['aircraft'] }).length) setShared({ selectedHex: null });
    });
    map.on('mouseenter', 'aircraft', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'aircraft', () => (map.getCanvas().style.cursor = ''));

    // Pulse the orbit rings.
    let raf = 0;
    const pulse = (t: number) => {
      if (ready && map.getLayer('orbit-ring')) {
        const k = (t % 1600) / 1600;
        map.setPaintProperty('orbit-ring', 'circle-radius', 16 + 22 * k);
        map.setPaintProperty('orbit-ring', 'circle-stroke-opacity', 0.9 * (1 - k));
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
      if (s.focus && s.focus !== prev.focus) {
        map.flyTo({ center: s.focus.center, zoom: s.focus.zoom ?? Math.max(map.getZoom(), 12), speed: 1.6 });
      }
      prev = s;
      if (ready) render(map, s);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);

    return () => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
      map.remove();
    };
  }, []);

  return <div ref={el} className="map" />;
}
