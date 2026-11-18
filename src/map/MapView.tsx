import { maplibregl } from './maplibre';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, subscribe, type State } from '../data/store';
import { passesCeiling } from '../lib/adsb';
import { circleRing, NM_TO_M, type LonLat } from '../lib/geo';
import { getPack } from '../lib/packs';
import { openExternal, openRadio } from '../ui/popout';
import { openWaypoint, placeWaypoint } from '../ui/Waypoints';
import { markColor, newMarkAt, openMark } from '../ui/Marks';
import { hasStatus, markLive, markStateLabel } from '../lib/waypoints';
import { addIcons, CLASS_COLORS, DRONE_COLOR, RADIO_COLOR } from './icons';
import { addTerrain, setTerrainOptions } from './terrain';
import { shipTypeName, stormSeverity } from '../lib/intel';
import { describeFeature, hoverHtml, HOVERABLE, radarTiles } from './popups';
import { LABEL_FONT, styleFor, tuneDarkStyle } from './styles';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

const SEVERITY_FILL = ['match', ['get', 'severity'], 'Extreme', '#FF4D4F', 'Severe', '#FF7A45', 'Moderate', '#FFB020', 'Minor', '#4C8DFF', '#8FA3B8'] as unknown as maplibregl.ExpressionSpecification;
const SEV_NUM = ['match', ['get', 'sev'], 4, '#FF4D4F', 3, '#FF7A45', 2, '#FFB020', 1, '#4C8DFF', '#8FA3B8'] as unknown as maplibregl.ExpressionSpecification;

const SOURCES = ['aoi', 'monitors', 'mark-areas', 'marks', 'wp-links', 'waypoints', 'team-trails', 'team', 'crime', 's311', 'hotspots', 'quakes', 'gauges', 'storms', 'ships', 'outages', 'radio', 'transit', 'areas', 'draw', 'weather', 'tfr', 'traffic-lines', 'traffic', 'cameras', 'fires', 'clusters', 'trails', 'orbits', 'drone-links', 'drones', 'aircraft'];

function addDataLayers(map: MlMap) {
  addIcons(map);
  for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  if (!map.getSource('newspins')) map.addSource('newspins', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 38, clusterMaxZoom: 14 });
  const L = (layer: maplibregl.LayerSpecification) => map.addLayer(layer);

  L({ id: 'outages-fill', type: 'fill', source: 'outages', paint: { 'fill-color': ['match', ['get', 'sev'], 3, '#FF7A45', 2, '#FFB020', 1, '#FDE68A', '#FDE68A'], 'fill-opacity': ['match', ['get', 'sev'], 3, 0.22, 2, 0.16, 1, 0.1, 0.05] } });
  L({ id: 'outages-line', type: 'line', source: 'outages', paint: { 'line-color': '#FFB020', 'line-width': 1, 'line-opacity': 0.5 } });
  L({ id: 'outages-label', type: 'symbol', source: 'outages', layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 11, 'symbol-placement': 'point' }, paint: { 'text-color': '#FFD58A', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  if (!map.getSource('radar'))
    map.addSource('radar', { type: 'raster', tiles: [radarTiles()], tileSize: 256, attribution: 'Radar: Iowa Environmental Mesonet / NWS NEXRAD' });
  L({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.55, 'raster-fade-duration': 0 } });
  L({ id: 'crime-heat', type: 'heatmap', source: 'crime', maxzoom: 14, paint: { 'heatmap-weight': ['interpolate', ['linear'], ['get', 'sev'], 0, 0.25, 3, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.4], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 22], 'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 14, 0], 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(76,141,255,0.35)', 0.5, 'rgba(255,176,32,0.55)', 0.8, 'rgba(255,122,69,0.7)', 1, 'rgba(255,77,79,0.85)'] } });
  L({ id: 'crime-pts', type: 'circle', source: 'crime', minzoom: 12, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6], 'circle-color': SEV_NUM, 'circle-stroke-color': '#0B0F14', 'circle-stroke-width': 1, 'circle-opacity': 0.9 } });
  L({ id: 's311', type: 'circle', source: 's311', minzoom: 11, paint: { 'circle-radius': 3.5, 'circle-color': '#A3E635', 'circle-opacity': 0.7, 'circle-stroke-color': '#0B0F14', 'circle-stroke-width': 1 } });
  L({ id: 'hotspots', type: 'circle', source: 'hotspots', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'frp'], 0, 4, 50, 9], 'circle-color': '#FF3D00', 'circle-opacity': 0.75, 'circle-blur': 0.4, 'circle-stroke-color': '#FFD08A', 'circle-stroke-width': 1 } });
  L({ id: 'quakes', type: 'circle', source: 'quakes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 1.5, 4, 5, 18], 'circle-color': 'rgba(192,132,252,0.25)', 'circle-stroke-color': '#C084FC', 'circle-stroke-width': 1.5 } });
  L({ id: 'quakes-label', type: 'symbol', source: 'quakes', layout: { 'text-field': ['concat', 'M', ['to-string', ['get', 'mag']]], 'text-font': LABEL_FONT, 'text-size': 10 }, paint: { 'text-color': '#E9D5FF', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.3 } });
  L({ id: 'gauges', type: 'circle', source: 'gauges', paint: { 'circle-radius': ['match', ['get', 'cat'], 'no_flooding', 3.5, 'unknown', 3, 6], 'circle-color': ['match', ['get', 'cat'], 'action', '#FFD84D', 'minor', '#FFB020', 'moderate', '#FF4D4F', 'major', '#C026D3', '#38BDF8'], 'circle-opacity': ['match', ['get', 'cat'], 'no_flooding', 0.5, 'unknown', 0.3, 1], 'circle-stroke-color': '#0B0F14', 'circle-stroke-width': 1 } });
  L({ id: 'storms', type: 'symbol', source: 'storms', layout: { 'text-field': ['get', 'glyph'], 'text-font': LABEL_FONT, 'text-size': 10, 'text-letter-spacing': 0.12, 'text-allow-overlap': true }, paint: { 'text-color': SEV_NUM, 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'ships', type: 'symbol', source: 'ships', layout: { 'text-field': '▲', 'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-font': LABEL_FONT, 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': ['match', ['get', 'kind'], 'Law enforcement', '#4C8DFF', 'Search & rescue', '#FF4D4F', 'Military', '#4C8DFF', 'Tanker', '#FFB020', 'Cargo', '#8FA3B8', 'Passenger', '#34D399', '#7DD3FC'], 'text-halo-color': '#0B0F14', 'text-halo-width': 1.4 } });
  L({ id: 'radio-fill', type: 'fill', source: 'radio', paint: { 'fill-color': RADIO_COLOR, 'fill-opacity': 0.04 } });
  L({ id: 'radio-line', type: 'line', source: 'radio', paint: { 'line-color': RADIO_COLOR, 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [1, 2] } });
  L({ id: 'radio-label', type: 'symbol', source: 'radio', layout: { 'text-field': ['concat', '◉ ', ['get', 'name']], 'text-font': LABEL_FONT, 'text-size': 10.5, 'symbol-placement': 'point' }, paint: { 'text-color': RADIO_COLOR, 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'weather-fill', type: 'fill', source: 'weather', paint: { 'fill-color': SEVERITY_FILL, 'fill-opacity': 0.12 } });
  L({ id: 'weather-line', type: 'line', source: 'weather', paint: { 'line-color': SEVERITY_FILL, 'line-width': 1.2, 'line-opacity': 0.7 } });
  L({ id: 'tfr-fill', type: 'fill', source: 'tfr', paint: { 'fill-color': '#FF4D4F', 'fill-opacity': 0.08 } });
  L({ id: 'tfr-line', type: 'line', source: 'tfr', paint: { 'line-color': '#FF4D4F', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
  L({ id: 'tfr-label', type: 'symbol', source: 'tfr', layout: { 'text-field': ['concat', 'TFR ', ['get', 'id']], 'text-font': LABEL_FONT, 'text-size': 11, 'symbol-placement': 'point' }, paint: { 'text-color': '#FF8A8C', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.4 } });
  L({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } });
  L({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.8 } });
  L({ id: 'areas-label', type: 'symbol', source: 'areas', layout: { 'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 12, 'symbol-placement': 'point' }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'monitors-line', type: 'line', source: 'monitors', paint: { 'line-color': '#C084FC', 'line-width': 1.6, 'line-dasharray': [1, 1.5], 'line-opacity': ['case', ['get', 'on'], 0.9, 0.35] } });
  L({ id: 'monitors-label', type: 'symbol', source: 'monitors', layout: { 'text-field': ['concat', '◉ ', ['get', 'name']], 'text-font': LABEL_FONT, 'text-size': 11, 'symbol-placement': 'line', 'text-max-angle': 30 }, paint: { 'text-color': '#D8B4FE', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.4 } });
  L({ id: 'mark-areas-fill', type: 'fill', source: 'mark-areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'done'], 0.03, 0.08] } });
  L({ id: 'mark-areas-line', type: 'line', source: 'mark-areas', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [3, 2] } });
  L({ id: 'marks-ping', type: 'circle', source: 'marks', filter: ['==', ['get', 'kind'], 'ping'], paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 } });
  L({ id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': ['match', ['get', 'kind'], 'objective', 8, 'investigate', 9, 'ping', 5, 6], 'circle-color': ['case', ['get', 'ring'], 'rgba(11,15,20,0.85)', ['get', 'color']], 'circle-stroke-color': ['case', ['get', 'ring'], ['get', 'color'], '#0B0F14'], 'circle-stroke-width': ['case', ['get', 'ring'], ['match', ['get', 'kind'], 'investigate', 2, 3], 1.5], 'circle-opacity': ['case', ['get', 'done'], 0.45, 1], 'circle-stroke-opacity': ['case', ['get', 'done'], 0.45, 1] } });
  L({ id: 'marks-q', type: 'symbol', source: 'marks', filter: ['==', ['get', 'kind'], 'investigate'], layout: { 'text-field': '?', 'text-font': LABEL_FONT, 'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['get', 'color'], 'text-opacity': ['case', ['get', 'done'], 0.45, 1] } });
  L({ id: 'marks-label', type: 'symbol', source: 'marks', layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 10.5, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-letter-spacing': 0.04, 'text-optional': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'wp-links', type: 'line', source: 'wp-links', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.75, 'line-dasharray': [2, 2] } });
  L({ id: 'waypoints', type: 'circle', source: 'waypoints', paint: { 'circle-radius': 9, 'circle-color': 'rgba(11,15,20,0.85)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5, 'circle-opacity': ['case', ['get', 'active'], 1, 0.4], 'circle-stroke-opacity': ['case', ['get', 'active'], 1, 0.4] } });
  L({ id: 'waypoints-label', type: 'symbol', source: 'waypoints', layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-letter-spacing': 0.06 }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'team-halo', type: 'circle', source: 'team', paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } });
  L({ id: 'team-trails', type: 'line', source: 'team-trails', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.55, 'line-dasharray': [2, 1] } });
  L({ id: 'team', type: 'circle', source: 'team', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0B0F14', 'circle-stroke-width': 2, 'circle-opacity': ['case', ['get', 'stale'], 0.45, 1] } });
  L({ id: 'team-label', type: 'symbol', source: 'team', layout: { 'text-field': ['get', 'name'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#7EE2A8', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.6 } });
  L({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#3DD6F5', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [3, 3] } });
  L({ id: 'traffic-lines', type: 'line', source: 'traffic-lines', layout: { 'line-cap': 'round' }, paint: { 'line-color': SEV_NUM, 'line-width': 4, 'line-opacity': 0.55 } });
  L({ id: 'cameras', type: 'symbol', source: 'cameras', minzoom: 9, layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.7, 'icon-allow-overlap': true } });
  L({ id: 'fires', type: 'symbol', source: 'fires', layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['get', 'acres'], 0, 0.7, 1000, 1.1, 20000, 1.5], 'icon-allow-overlap': true, 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 10.5, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#FFB020', 'text-halo-color': '#0B0F14', 'text-halo-width': 1.5 } });
  L({ id: 'traffic', type: 'symbol', source: 'traffic', layout: { 'icon-image': ['concat', 'traffic-', ['to-string', ['get', 'sev']]], 'icon-size': 0.8, 'icon-allow-overlap': true } });
  L({ id: 'transit', type: 'symbol', source: 'transit', layout: { 'icon-image': ['concat', 'transit-', ['to-string', ['get', 'sev']]], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 0.75], 'icon-allow-overlap': true } });
  L({ id: 'news-clusters', type: 'circle', source: 'newspins', filter: ['has', 'point_count'], paint: { 'circle-color': 'rgba(76,141,255,0.18)', 'circle-stroke-color': '#4C8DFF', 'circle-stroke-width': 1.5, 'circle-radius': ['step', ['get', 'point_count'], 13, 5, 16, 15, 20] } });
  L({ id: 'news-cluster-count', type: 'symbol', source: 'newspins', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': LABEL_FONT, 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#CFE0FF' } });
  L({ id: 'news', type: 'symbol', source: 'newspins', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['concat', 'news-', ['to-string', ['get', 'sev']]], 'icon-size': ['case', ['==', ['get', 'precision'], 'place'], 0.8, 0.62], 'icon-allow-overlap': true }, paint: { 'icon-opacity': ['case', ['==', ['get', 'precision'], 'place'], 1, 0.75] } });
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
  vis(['news', 'news-clusters', 'news-cluster-count'], s.layers.news);
  vis(['fires'], s.layers.fires);
  vis(['radar'], s.layers.radar);
  vis(['crime-heat', 'crime-pts'], s.layers.crime);
  vis(['s311'], s.layers.s311);
  vis(['hotspots'], s.layers.hotspots);
  vis(['quakes', 'quakes-label'], s.layers.quakes);
  vis(['gauges'], s.layers.floods);
  vis(['storms'], s.layers.storms);
  vis(['ships'], s.layers.ships);
  const pt = (id: string, at: LonLat, props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties: { id, ...props }, geometry: { type: 'Point', coordinates: at } });
  setData(map, 'crime', fc(s.crimes.map((x) => pt(x.id, x.location, { sev: x.severity }))));
  setData(map, 's311', fc(s.requests311.map((x) => pt(x.id, x.location))));
  setData(map, 'hotspots', fc(s.hotspots.map((x) => pt(x.id, x.location, { frp: x.frp }))));
  setData(map, 'quakes', fc(s.quakes.map((x) => pt(x.id, x.location, { mag: Math.round(x.mag * 10) / 10 }))));
  setData(map, 'gauges', fc(s.gauges.map((x) => pt(x.id, x.location, { cat: x.category }))));
  setData(map, 'storms', fc(s.storms.map((x) => pt(x.id, x.location, { sev: stormSeverity(x), glyph: /tornado|funnel/i.test(x.type) ? 'TOR' : /hail/i.test(x.type) ? 'HAIL' : /flood|rain/i.test(x.type) ? 'FLD' : /snow|ice/i.test(x.type) ? 'SNOW' : 'WIND' }))));
  setData(map, 'ships', fc(s.ships.map((x) => pt(x.mmsi, x.location, { rot: x.heading ?? x.cog ?? 0, kind: shipTypeName(x.type) }))));
  vis(['radio-fill', 'radio-line', 'radio-label'], s.layers.radio);
  vis(['transit'], s.layers.transit);
  vis(['outages-fill', 'outages-line', 'outages-label'], s.layers.outages);
  vis(['drones', 'drone-links'], s.layers.drones);
  vis(['areas-fill', 'areas-line', 'areas-label', 'monitors-line', 'monitors-label'], s.layers.areas);
  vis(['team', 'team-label', 'team-trails', 'team-halo', 'waypoints', 'waypoints-label', 'wp-links', 'marks', 'marks-ping', 'marks-label', 'mark-areas-fill', 'mark-areas-line'], s.layers.team);

  setData(map, 'aoi', { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circleRing(pack.center, pack.radiusNm * NM_TO_M) } });
  setData(map, 'weather', fc(s.alerts.filter((a) => a.geometry).map((a) => ({ type: 'Feature', properties: { id: a.id, severity: a.severity }, geometry: a.geometry! }))));
  setData(map, 'tfr', fc(s.tfrs.map((t) => ({ type: 'Feature', properties: { id: t.id }, geometry: t.geometry }))));
  const TEAM_COLOR = { phone: '#2BD47D', mesh: '#FBBF24', ntfy: '#3DD6F5' } as const;
  setData(map, 'team', fc(s.team.filter((m): m is typeof m & { location: LonLat } => !!m.location && !m.dark).map((m) => ({ type: 'Feature', properties: { id: m.id, name: m.name, color: TEAM_COLOR[m.source], stale: Date.now() - m.at > 10 * 60_000 }, geometry: { type: 'Point', coordinates: m.location } }))));
  const liveMarks = s.marks.filter((m) => markLive(m));
  setData(map, 'marks', fc(liveMarks.map((m) => ({ type: 'Feature', properties: { id: m.id, kind: m.kind, color: markColor(m), done: m.state === 'done', ring: hasStatus(m.kind), label: m.kind === 'ping' ? `PING · ${m.by}` : `${m.name}${hasStatus(m.kind) && m.state !== 'active' ? ` · ${markStateLabel(m.kind, m.state).toLowerCase()}` : ''}` }, geometry: { type: 'Point', coordinates: m.location } }))));
  setData(map, 'mark-areas', fc(liveMarks.filter((m) => m.kind === 'area' && m.radiusM).map((m) => ({ type: 'Feature', properties: { id: m.id, color: markColor(m), done: m.state === 'done' }, geometry: { type: 'Polygon', coordinates: [circleRing(m.location, m.radiusM!, 72)] } }))));
  const wpColor = (w: (typeof s.waypoints)[number]) => (w.priority === 'urgent' ? '#FF4D4F' : '#3DD6F5');
  const shownWps = s.waypoints.filter((w) => w.state === 'active' || Date.now() - w.at < 30 * 60_000);
  setData(map, 'waypoints', fc(shownWps.map((w) => ({ type: 'Feature', properties: { id: w.id, color: wpColor(w), active: w.state === 'active', label: `${w.name}${w.state !== 'active' ? ` (${w.state})` : ''}` }, geometry: { type: 'Point', coordinates: w.location } }))));
  setData(
    map,
    'wp-links',
    fc(
      shownWps
        .filter((w) => w.state === 'active')
        .flatMap((w) =>
          s.team
            .filter((m) => m.location && !m.dark && m.channelId === w.channelId && m.id.startsWith('phone:') && (!w.to.length || w.to.includes(m.id.split(':').slice(2).join(':'))) && w.acks[m.id.split(':').slice(2).join(':')]?.state !== 'arrived')
            .map((m) => ({ type: 'Feature' as const, properties: { color: wpColor(w) }, geometry: { type: 'LineString' as const, coordinates: [m.location!, w.location] } })),
        ),
    ),
  );
  setData(map, 'team-trails', fc(s.team.filter((m) => !m.dark && (m.trail?.length ?? 0) > 1).map((m) => ({ type: 'Feature', properties: { color: TEAM_COLOR[m.source] }, geometry: { type: 'LineString', coordinates: m.trail! } }))));
  setData(map, 'monitors', fc(s.monitors.filter((m) => m.kind === 'proximity' && m.center).map((m) => ({ type: 'Feature', properties: { id: m.id, name: m.name, on: m.enabled }, geometry: { type: 'LineString', coordinates: circleRing(m.center!, m.radiusM, 96) } }))));
  setData(map, 'areas', fc(s.areas.filter((a) => a.packId === s.packId && a.polygon.length >= 3).map((a) => ({ type: 'Feature', properties: { name: a.name, color: a.color }, geometry: { type: 'Polygon', coordinates: [[...a.polygon, a.polygon[0]]] } }))));
  setData(map, 'traffic', fc(s.traffic.map((t) => ({ type: 'Feature', properties: { id: t.id, sev: t.severity }, geometry: { type: 'Point', coordinates: t.location } }))));
  setData(map, 'traffic-lines', fc(s.traffic.filter((t) => t.path).map((t) => ({ type: 'Feature', properties: { sev: t.severity }, geometry: { type: 'LineString', coordinates: t.path! } }))));
  setData(map, 'cameras', fc([...s.cameras, ...s.webcams].map((c) => ({ type: 'Feature', properties: { id: c.id, icon: c.provider === 'usgs' ? 'webcam' : 'camera' }, geometry: { type: 'Point', coordinates: c.location } }))));
  setData(map, 'outages', fc(s.outages.filter((o) => o.geometry).map((o) => ({ type: 'Feature', properties: { id: o.id, sev: o.severity, label: `${o.county}: ${o.customers.toLocaleString('en-US')} out` }, geometry: o.geometry! }))));
  setData(map, 'transit', fc(s.transit.flatMap((t) => t.points.map((p) => ({ type: 'Feature', properties: { id: t.id, sev: t.severity }, geometry: { type: 'Point', coordinates: p } })))));
  setData(map, 'newspins', fc(s.news.filter((n) => n.pin && n.local).map((n) => ({ type: 'Feature', properties: { id: n.id, sev: n.severity, precision: n.precision }, geometry: { type: 'Point', coordinates: n.pin! } }))));
  setData(map, 'fires', fc(s.fires.map((f) => ({ type: 'Feature', properties: { id: f.id, icon: f.kind === 'prescribed' ? 'fire-rx' : `fire-${f.severity}`, acres: f.acres ?? 0, label: `${f.name}${f.acres ? ` · ${Math.round(f.acres).toLocaleString('en-US')} ac` : ''}` }, geometry: { type: 'Point', coordinates: f.location } }))));
  setData(map, 'radio', fc(pack.radioFeeds.filter((r) => r.coverage).map((r, i) => ({ type: 'Feature', properties: { idx: pack.radioFeeds.indexOf(r), name: r.name, i }, geometry: { type: 'Polygon', coordinates: [circleRing([r.coverage![0], r.coverage![1]], r.coverage![2] * 1000, 64)] } }))));
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

const CLICKABLE = ['marks', 'mark-areas-fill', 'waypoints', 'team', 'aircraft', 'weather-fill', 'tfr-fill', 'crime-pts', 's311', 'hotspots', 'quakes', 'gauges', 'storms', 'ships', 'cameras', 'fires', 'traffic', 'transit', 'news', 'news-clusters', 'clusters', 'drones', 'outages-fill', 'radio-line', 'radio-label'];

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s0 = getState();
    const pack = getPack(s0.packId);
    const map = new maplibregl.Map({ container: el.current!, style: styleFor(s0.basemap), center: pack.center, zoom: pack.zoom, attributionControl: { compact: true }, fadeDuration: 0, doubleClickZoom: true });
    if (import.meta.env.DEV) (window as unknown as { __vgMap?: MlMap }).__vgMap = map; // dev-only debugging handle
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

    let ready = false;
    const terrainOpts = () => {
      const st = getState();
      return { ...st.settings.map, satellite: st.basemap === 'satellite' };
    };
    map.on('style.load', () => {
      if (getState().basemap === 'dark') tuneDarkStyle(map);
      try {
        addTerrain(map, terrainOpts());
      } catch (e) {
        console.warn('terrain unavailable', e);
      }
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
      if (s.pickPoint) {
        const center: LonLat = [e.lngLat.lng, e.lngLat.lat];
        setShared({ monitors: s.monitors.map((m) => (m.id === s.pickPoint ? { ...m, center } : m)) });
        setState({ pickPoint: null, tab: 'areas' });
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
      } else if (f.layer.id === 'transit') {
        const t = s.transit.find((x) => x.id === p.id);
        if (t) popup.setLngLat(e.lngLat).setHTML(`<small>${esc(t.agency)}${t.cause ? ` · ${esc(t.cause.toUpperCase())}` : ''}${t.effect ? ` · ${esc(t.effect)}` : ''}</small><b>${esc(t.title)}</b><p>${esc(t.detail)}</p>`).addTo(map);
      } else if (f.layer.id === 'outages-fill') {
        const o = s.outages.find((x) => x.id === p.id);
        if (o) popup.setLngLat(e.lngLat).setHTML(`<small>POWER OUTAGE · DOE ODIN</small><b>${esc(o.county)} County: ${o.customers.toLocaleString('en-US')} customers out</b><p>${esc(o.utilities.join(', '))}</p>`).addTo(map);
      } else if (f.layer.id === 'news') {
        const n = s.news.find((x) => x.id === p.id);
        if (n) void openExternal(n.url, n.source);
      } else if (f.layer.id === 'news-clusters') {
        const src = map.getSource('newspins') as GeoJSONSource;
        void src.getClusterExpansionZoom(Number(p.cluster_id)).then((z) => map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as LonLat, zoom: z + 0.5 }));
      } else if (f.layer.id === 'fires') {
        const x = s.fires.find((y) => y.id === p.id);
        if (x)
          popup
            .setLngLat(x.location)
            .setHTML(`<small>${x.kind === 'prescribed' ? 'PRESCRIBED BURN' : 'WILDFIRE'} · NIFC</small><b>${esc(x.name)}</b><p>${x.acres != null ? `${Math.round(x.acres).toLocaleString('en-US')} acres` : 'Size unknown'}${x.containedPct != null ? ` · ${x.containedPct}% contained` : ''}${x.county ? ` · ${esc(x.county)} County` : ''}</p>${x.cause ? `<p>Cause: ${esc(x.cause)}</p>` : ''}`)
            .addTo(map);
      } else if (['crime-pts', 's311', 'hotspots', 'quakes', 'gauges', 'storms', 'ships'].includes(f.layer.id)) {
        const html = describeFeature(f.layer.id, String(p.id), s, esc);
        if (html) popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else if (f.layer.id.startsWith('radio-')) {
        const feed = getPack(s.packId).radioFeeds[Number(p.idx)];
        if (feed) void openRadio(feed);
      } else if (f.layer.id === 'clusters') {
        const c = s.clusters.find((x) => x.id === p.id);
        if (c) popup.setLngLat(c.center).setHTML(`<small>DEVELOPING · ${c.sources.join(', ')}</small>${c.signals.map((x) => `<p>${esc(x.title)}</p>`).join('')}`).addTo(map);
      } else if (f.layer.id === 'weather-fill') {
        const a = s.alerts.find((x) => x.id === p.id);
        if (a) popup.setLngLat(e.lngLat).setHTML(`<small>NWS · ${esc(a.senderName)}</small><b>${esc(a.headline || a.event)}</b><p>${esc(a.areaDesc)}</p>${a.instruction ? `<p>${esc(a.instruction.slice(0, 300))}</p>` : ''}`).addTo(map);
      } else if (f.layer.id === 'tfr-fill') {
        const t = s.tfrs.find((x) => x.id === p.id);
        if (t) {
          popup.setLngLat(e.lngLat).setHTML(`<small>FAA TFR · ${esc(t.type)} · NOTAM ${esc(t.id)}</small><b>${esc(t.title)}</b><p>${esc(t.description.slice(0, 300))}</p>`).addTo(map);
          if (t.url) void openExternal(t.url, `TFR ${t.id}`);
        }
      } else if (f.layer.id === 'marks' || f.layer.id === 'mark-areas-fill') openMark(String(p.id));
      else if (f.layer.id === 'waypoints') openWaypoint(String(p.id));
      else if (f.layer.id === 'team') setState({ modal: 'agent', agentId: String(p.id) });
      else if (f.layer.id === 'drones') setState({ tab: 'sky' });
    });
    // Right-click: share this spot with the team.
    map.on('contextmenu', (e) => {
      if (getState().drawing) return;
      const spot = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      const el = document.createElement('div');
      el.className = 'ctx-menu';
      el.innerHTML = `<small>${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}</small>`;
      const item = (label: string, fn: () => void) => {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = label;
        b.onclick = () => {
          popup.remove();
          fn();
        };
        el.appendChild(b);
      };
      const at: [number, number] = [spot.lon, spot.lat];
      item('Ping here', () => newMarkAt(at, 'ping'));
      item('Add marker', () => newMarkAt(at, 'marker'));
      item('Investigate (?)', () => newMarkAt(at, 'investigate'));
      item('Area of interest', () => newMarkAt(at, 'area'));
      item('Objective', () => newMarkAt(at, 'objective'));
      item('Place waypoint for agents', () => placeWaypoint(at));
      if (!getState().channels.some((c) => c.enabled)) {
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
        return;
      }
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Share this spot with the team';
      btn.onclick = () => {
        popup.remove();
        setState({ teamDraft: { text: '', spot: { ...spot, label: 'Shared spot' } }, tab: 'team' });
      };
      el.appendChild(btn);
      popup.setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    });
    map.on('dblclick', (e) => {
      const d = getState().drawing;
      if (d) e.preventDefault();
    });
    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: '300px', className: 'vg-popup vg-hover' });
    let hoverKey = '';
    map.on('mousemove', (e) => {
      const st = getState();
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - 4, e.point.y - 4],
        [e.point.x + 4, e.point.y + 4],
      ];
      const found = st.drawing ? [] : map.queryRenderedFeatures(box, { layers: HOVERABLE.filter((l) => map.getLayer(l)) });
      // Points first, then outlines and labels, then filled areas.
      const rank = (id: string) => (id.endsWith('-fill') ? 2 : id.endsWith('-line') || id.endsWith('-label') ? 1 : 0);
      const f = found.sort((a, b) => rank(a.layer.id) - rank(b.layer.id))[0];
      if (!f) {
        hoverKey = '';
        hover.remove();
        return;
      }
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      const isPoint = f.geometry.type === 'Point';
      const at: LonLat = isPoint ? ((f.geometry as GeoJSON.Point).coordinates as LonLat) : [e.lngLat.lng, e.lngLat.lat];
      const key = `${f.layer.id}:${p.id ?? p.hex ?? p.cluster_id ?? p.name ?? p.idx}:${p.icon ?? ''}`;
      if (key !== hoverKey) {
        const html = hoverHtml(f.layer.id, p, st, esc, f.layer.id.startsWith('radio-') ? getPack(st.packId).radioFeeds[Number(p.idx)]?.name : undefined);
        hoverKey = key;
        if (!html) {
          hover.remove();
          return;
        }
        hover.setHTML(html);
      }
      hover.setLngLat(at).addTo(map);
    });
    map.on('mouseout', () => {
      hoverKey = '';
      hover.remove();
    });

    // Coordinate / zoom readout (tactical HUD)
    const hud = el.current!.parentElement?.querySelector('.hud-coords') as HTMLElement | null;
    const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;
    map.on('mousemove', (e) => {
      if (hud) hud.textContent = `${fmt(e.lngLat.lat, 'N', 'S')}  ${fmt(e.lngLat.lng, 'E', 'W')}  ·  Z${map.getZoom().toFixed(1)}  ·  ${Math.round((map.getBearing() + 360) % 360).toString().padStart(3, '0')}°`;
    });

    for (const l of CLICKABLE) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = getState().drawing ? 'crosshair' : ''));
    }

    // Refresh radar every 5 minutes (the tile URL carries a time-bucket to bust caches).
    const radarTimer = window.setInterval(() => getState().layers.radar && (map.getSource('radar') as maplibregl.RasterTileSource | undefined)?.setTiles([radarTiles()]), 5 * 60_000);
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
      if (ready && map.getLayer('marks-ping')) {
        const k4 = (t % 1400) / 1400;
        map.setPaintProperty('marks-ping', 'circle-radius', 8 + 26 * k4);
        map.setPaintProperty('marks-ping', 'circle-stroke-opacity', 0.9 * (1 - k4));
      }
      // Team highlight: rings pulse around every agent for 10 s after the agents chip is clicked.
      if (ready && map.getLayer('team-halo')) {
        const since = Date.now() - getState().teamHighlight;
        const on = since < 10_000;
        const k3 = (t % 1200) / 1200;
        map.setPaintProperty('team-halo', 'circle-radius', on ? 10 + 26 * k3 : 10);
        map.setPaintProperty('team-halo', 'circle-stroke-opacity', on ? 0.95 * (1 - k3) : 0);
      }
      raf = requestAnimationFrame(pulse);
    };
    raf = requestAnimationFrame(pulse);

    // Reticle marking whatever was last selected from a list or the dashboard.
    const markEl = document.createElement('div');
    markEl.className = 'focus-mark';
    const mark = new maplibregl.Marker({ element: markEl });
    let markTimer = 0;
    const showMark = (f: NonNullable<State['focus']>) => {
      markEl.innerHTML = '<i></i><b></b>';
      (markEl.querySelector('b') as HTMLElement).textContent = f.label ?? '';
      markEl.classList.toggle('has-label', !!f.label);
      mark.setLngLat(f.center).addTo(map);
      window.clearTimeout(markTimer);
      markTimer = window.setTimeout(() => mark.remove(), 45_000);
    };
    if (s0.focus && Date.now() - s0.focus.at < 45_000) {
      map.jumpTo({ center: s0.focus.center, zoom: s0.focus.zoom ?? 12 });
      showMark(s0.focus);
    }

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
        if (s.focus.bounds) map.fitBounds(s.focus.bounds, { padding: 80, maxZoom: 16, duration: 1200 });
        else {
          map.flyTo({ center: s.focus.center, zoom: s.focus.zoom ?? Math.max(map.getZoom(), 12), speed: 1.6 });
          showMark(s.focus);
        }
      }
      if (s.drawing !== prev.drawing || s.pickPoint !== prev.pickPoint) map.getCanvas().style.cursor = s.drawing || s.pickPoint ? 'crosshair' : '';
      if (ready && s.settings.map !== prev.settings.map) setTerrainOptions(map, terrainOpts());
      if (ready && s.layers.radar && !prev.layers.radar) (map.getSource('radar') as maplibregl.RasterTileSource | undefined)?.setTiles([radarTiles()]);
      prev = s;
      if (ready) render(map, s);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);
    return () => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.clearInterval(radarTimer);
      popup.remove();
      window.clearTimeout(markTimer);
      mark.remove();
      map.remove();
    };
  }, []);

  return (
    <>
      <div ref={el} className="map" />
      <div className="map-grid" aria-hidden />
      <div className="hud-coords mono" aria-live="off" />
    </>
  );
}
