import { describe, expect, it } from 'vitest';
import { alertsUrl, parseAlerts, samplePoints } from '../src/lib/nws';

const feature = (id: string, severity: string, event = 'Winter Storm Warning') => ({
  id,
  geometry: null,
  properties: { id, event, severity, sent: '2026-11-16T10:00:00-07:00', areaDesc: 'Denver', affectedZones: ['https://api.weather.gov/zones/forecast/COZ040'] },
});

describe('nws', () => {
  it('dedupes alerts across sample points and sorts by severity', () => {
    const alerts = parseAlerts([
      { features: [feature('a', 'Moderate'), feature('b', 'Severe')] },
      { features: [feature('a', 'Moderate')] },
    ] as never);
    expect(alerts.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('builds lat,lon point queries', () => {
    expect(alertsUrl([-104.99, 39.74])).toBe('https://api.weather.gov/alerts/active?point=39.7400,-104.9900');
  });

  it('samples the center plus four points', () => {
    expect(samplePoints([-104.99, 39.74], 25)).toHaveLength(5);
  });
});
