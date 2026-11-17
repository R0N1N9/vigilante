import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { Basemap } from '../data/store';

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const LABEL_FONT = ['Noto Sans Regular'];

const DARK_URL = 'https://tiles.openfreemap.org/styles/dark';

/** Satellite: USGS National Map imagery (public domain, US coverage). */
const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    usgs: {
      type: 'raster',
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0B0F14' } },
    { id: 'usgs', type: 'raster', source: 'usgs', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.85 } },
  ],
};

export function styleFor(b: Basemap): string | StyleSpecification {
  return b === 'satellite' ? SATELLITE : DARK_URL;
}

/** Nudge the OpenFreeMap dark style toward the console palette. */
export function tuneDarkStyle(map: MlMap) {
  type PaintProp = Parameters<MlMap['setPaintProperty']>[1];
  const set = (id: string, prop: PaintProp, value: string) => {
    if (map.getLayer(id)) {
      try {
        map.setPaintProperty(id, prop, value);
      } catch {
        /* layer shape differs: ignore */
      }
    }
  };
  set('background', 'background-color', '#0B0F14');
  set('water', 'fill-color', '#0A1620');
}
