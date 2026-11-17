import { describe, expect, it } from 'vitest';
import { decodePolyline } from '../src/lib/polyline';
import { nearestCameras, parseCotripIncidents, parseGa511Cameras, parseGa511Events, trafficSeverity } from '../src/lib/traffic';

const atl: [number, number] = [-84.388, 33.749];

describe('polyline', () => {
  it('decodes the reference example', () => {
    // Google's documented example: _p~iF~ps|U_ulLnnqC_mqNvxq`@
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts[0][0]).toBeCloseTo(-120.2, 5);
    expect(pts[0][1]).toBeCloseTo(38.5, 5);
    expect(pts[2][0]).toBeCloseTo(-126.453, 5);
    expect(pts[2][1]).toBeCloseTo(43.252, 5);
  });
});

describe('Georgia 511', () => {
  it('parses events in the area (sample shape from 511ga.org docs)', () => {
    const ev = parseGa511Events(
      [
        { ID: 1, RoadwayName: 'I-85', Description: 'Crash on I-85 NB at 10th St. 2 left lanes blocked.', EventType: 'accidentsAndIncidents', Subtype: 'crash', Latitude: 33.781, Longitude: -84.387, IsFullClosure: false, LastUpdated: 1794879000, EncodedPolyline: '' },
        { ID: 2, RoadwayName: 'SR 1', Description: 'Road construction', EventType: 'roadwork', Latitude: 34.06, Longitude: -85.23, IsFullClosure: false },
      ],
      atl,
      25,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ id: 'ga511:1', severity: 2, title: 'Crash · I-85', updated: 1794879000000 });
  });

  it('parses cameras and finds the nearest', () => {
    const cams = parseGa511Cameras(
      [
        { Id: 186, Location: 'GDOT-0054: SR154 W at StantonRd', Roadway: 'SR154', Direction: 'Westbound', Latitude: 33.698067, Longitude: -84.44784, Views: [{ Url: 'https://511ga.org/map/Cctv/186', Status: 'Enabled' }] },
        { Id: 187, Location: 'GDOT-0596', Latitude: 33.935137, Longitude: -84.256115, Views: [{ Url: 'https://511ga.org/map/Cctv/187' }] },
      ],
      atl,
      25,
    );
    expect(cams).toHaveLength(2);
    expect(nearestCameras(cams, [-84.44, 33.7], 1)[0].id).toBe('ga511:186');
  });
});

describe('COtrip (tolerant parser)', () => {
  it('reads a GeoJSON feature collection', () => {
    const ev = parseCotripIncidents(
      { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'x1', geometry: { type: 'Point', coordinates: [-104.99, 39.74] }, properties: { type: 'Crash', travelerInformationMessage: 'Crash on I-25 SB, right lane closed', routeName: 'I-25' } }] },
      [-104.9903, 39.7392],
      25,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ roadway: 'I-25', fullClosure: true, severity: 2 });
  });
});

describe('trafficSeverity', () => {
  it('ranks', () => {
    expect(trafficSeverity('roadwork', false, 'paving')).toBe(0);
    expect(trafficSeverity('incident', false, 'disabled vehicle')).toBe(2);
    expect(trafficSeverity('incident', false, 'fatal crash')).toBe(3);
  });
});
