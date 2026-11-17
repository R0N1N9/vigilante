import mlcontour from 'maplibre-contour';
import { maplibregl } from './maplibre';
import type { Map as MlMap } from 'maplibre-gl';
import { LABEL_FONT } from './styles';

/**
 * Terrain from the free AWS Open Data "Terrarium" elevation tiles (no key).
 * Used for hillshade, contour lines (generated in the browser by
 * maplibre-contour) and optional 3D terrain.
 */
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

let dem: InstanceType<typeof mlcontour.DemSource> | null = null;

function demSource() {
  if (!dem) {
    dem = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 13, worker: true, cacheSize: 120 });
    dem.setupMaplibre(maplibregl);
  }
  return dem;
}

/** First layer of a given type, so terrain can be slotted underneath roads and labels. */
function firstLayerOf(map: MlMap, types: string[]): string | undefined {
  return map.getStyle().layers?.find((l) => types.includes(l.type) && !l.id.startsWith('vg-'))?.id;
}

export interface TerrainOptions {
  hillshade: boolean;
  contours: boolean;
  terrain3d: boolean;
  satellite: boolean;
}

/** Add (or re-add after a style change) the terrain sources and layers. */
export function addTerrain(map: MlMap, o: TerrainOptions) {
  const d = demSource();
  if (!map.getSource('vg-dem')) map.addSource('vg-dem', { type: 'raster-dem', tiles: [d.sharedDemProtocolUrl], encoding: 'terrarium', tileSize: 256, maxzoom: 13 });
  if (!map.getSource('vg-dem-3d')) map.addSource('vg-dem-3d', { type: 'raster-dem', tiles: [d.sharedDemProtocolUrl], encoding: 'terrarium', tileSize: 256, maxzoom: 13 });
  if (!map.getSource('vg-contours'))
    map.addSource('vg-contours', {
      type: 'vector',
      tiles: [
        d.contourProtocolUrl({
          multiplier: 3.28084, // feet
          thresholds: { 9: [500, 2500], 11: [200, 1000], 12: [100, 500], 14: [40, 200], 15: [20, 100] },
          elevationKey: 'ele',
          levelKey: 'level',
          contourLayer: 'contours',
        }),
      ],
      maxzoom: 15,
    });

  const below = o.satellite ? undefined : firstLayerOf(map, ['line', 'symbol']);
  if (!map.getLayer('vg-hillshade'))
    map.addLayer(
      {
        id: 'vg-hillshade',
        type: 'hillshade',
        source: 'vg-dem',
        paint: {
          'hillshade-exaggeration': o.satellite ? 0.25 : 0.55,
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': o.satellite ? '#ffffff' : '#2a3a4a',
          'hillshade-accent-color': '#0B0F14',
          'hillshade-illumination-direction': 315,
        },
      },
      below,
    );
  if (!map.getLayer('vg-contour-lines'))
    map.addLayer(
      {
        id: 'vg-contour-lines',
        type: 'line',
        source: 'vg-contours',
        'source-layer': 'contours',
        paint: {
          'line-color': o.satellite ? 'rgba(255,255,255,0.5)' : 'rgba(61,214,245,0.9)',
          'line-opacity': ['match', ['get', 'level'], 1, o.satellite ? 0.5 : 0.32, o.satellite ? 0.25 : 0.14],
          'line-width': ['match', ['get', 'level'], 1, 1, 0.6],
        },
      },
      below,
    );
  if (!map.getLayer('vg-contour-labels'))
    map.addLayer({
      id: 'vg-contour-labels',
      type: 'symbol',
      source: 'vg-contours',
      'source-layer': 'contours',
      filter: ['>', ['get', 'level'], 0],
      layout: { 'symbol-placement': 'line', 'text-size': 9.5, 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' ft'], 'text-font': LABEL_FONT },
      paint: { 'text-color': o.satellite ? '#ffffff' : 'rgba(61,214,245,0.55)', 'text-halo-color': '#0B0F14', 'text-halo-width': 1 },
    });
  setTerrainOptions(map, o);
}

export function setTerrainOptions(map: MlMap, o: TerrainOptions) {
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('vg-hillshade', o.hillshade);
  vis('vg-contour-lines', o.contours);
  vis('vg-contour-labels', o.contours);
  const has = !!map.getTerrain();
  if (o.terrain3d && !has) {
    map.setTerrain({ source: 'vg-dem-3d', exaggeration: 1.4 });
    if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 });
  } else if (!o.terrain3d && has) {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, duration: 600 });
  }
}
