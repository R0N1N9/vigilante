import { describe, expect, it } from 'vitest';
import { fireSeverity, parseWfigs, wfigsQuery } from '../src/lib/fires';
import { parseWindy } from '../src/lib/webcams';

const denver: [number, number] = [-104.9903, 39.7392];
const fire = (id: string, type: string, lon: number, lat: number, acres: number | null, contained: number | null) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [lon, lat] },
  properties: { IrwinID: id, IncidentName: 'COAL CREEK', IncidentTypeCategory: type, IncidentSize: acres, PercentContained: contained, POOCounty: 'Jefferson' },
});

describe('NIFC wildfires', () => {
  it('parses incidents, ranks by severity then distance', () => {
    const f = parseWfigs({ features: [fire('a', 'RX', -105.2, 39.8, 50, null), fire('b', 'WF', -105.25, 39.9, 1500, 10), fire('c', 'WF', -106.5, 39.7, 20, 90)] }, denver);
    expect(f.map((x) => x.id)).toEqual(['wfigs:b', 'wfigs:c', 'wfigs:a']);
    expect(f[0]).toMatchObject({ name: 'Coal Creek', kind: 'wildfire', severity: 3, county: 'Jefferson' });
    expect(f[2]).toMatchObject({ kind: 'prescribed', severity: 0 });
  });
  it('severity', () => {
    expect(fireSeverity('wildfire', 5, null, 10)).toBe(2); // small but close
    expect(fireSeverity('wildfire', 5, null, 60)).toBe(1);
    expect(fireSeverity('wildfire', 5000, 100, 10)).toBe(0); // fully contained
  });
  it('builds a bounded geojson query', () => {
    const u = new URL(wfigsQuery(denver, 75));
    expect(u.searchParams.get('f')).toBe('geojson');
    expect(u.searchParams.get('geometry')!.split(',')).toHaveLength(4);
  });
});

describe('Windy webcams', () => {
  it('maps v3 webcams to cameras', () => {
    const c = parseWindy({ webcams: [{ webcamId: 123, title: 'Denver skyline', status: 'active', location: { latitude: 39.75, longitude: -104.99, city: 'Denver' }, images: { current: { preview: 'https://imgproxy.windy.com/x.jpg' } }, urls: { detail: 'https://www.windy.com/webcams/123' } }, { webcamId: 9, status: 'inactive', location: { latitude: 1, longitude: 1 } }] });
    expect(c).toEqual([{ id: 'windy:123', name: 'Denver skyline', location: [-104.99, 39.75], imageUrl: 'https://imgproxy.windy.com/x.jpg', roadway: 'Denver', direction: '', provider: 'windy', pageUrl: 'https://www.windy.com/webcams/123' }]);
  });
});
