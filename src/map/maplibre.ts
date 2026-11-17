/**
 * MapLibre GL v6 entry point. v6 loads its tile worker from a separate file
 * next to the library; bundlers move the library, so point it at the worker
 * explicitly. Import maplibre from here, not from 'maplibre-gl'.
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
