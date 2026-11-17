// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  airSeverity, applyAis, crimeSeverity, gaugeSeverity, hourHistogram, parseAir, parseAirportStatus, parseAtlantaCrime, parseDenver311, parseDenverCrime,
  parseFirms, parseGauges, parseLsr, parseQuakes, parseUsgsCams, parseWanted, quakeSeverity, stormSeverity, usgsImageUrl, type Ship,
} from '../src/lib/intel';

const denver: [number, number] = [-104.9903, 39.7392];
const atlanta: [number, number] = [-84.388, 33.749];

describe('crime', () => {
  it('parses Denver offenses (ODC_CRIME_OFFENSES_P shape)', () => {
    const c = parseDenverCrime({ features: [{ attributes: { OFFENSE_ID: 'DP1', OFFENSE_TYPE_ID: 'agg-aslt-shoot', OFFENSE_CATEGORY_ID: 'aggravated-assault', REPORTED_DATE: 1794095220000, INCIDENT_ADDRESS: '2300 BLK CLEVELAND PL', GEO_LON: -104.979, GEO_LAT: 39.748, NEIGHBORHOOD_ID: 'five-points' } }] });
    expect(c[0]).toMatchObject({ id: 'den:DP1', offense: 'Agg Aslt Shoot', category: 'Aggravated Assault', neighborhood: 'Five Points', firearm: true, severity: 3 });
  });
  it('parses Atlanta incidents (APD OpenDataWebsite_Crime_view shape)', () => {
    const c = parseAtlantaCrime({ features: [{ attributes: { ReportNumber: '26-1', NIBRS_Offense: 'Destruction/Damage/Vandalism of Property', Crime_Against: 'Property', FireArmInvolved: 'no', ReportDate: 1791566040000, StreetAddress: '99 CENTENNIAL OLYMPIC PARK DR SW', Longitude: -84.3935, Latitude: 33.7578, NhoodName: 'Downtown' } }] });
    expect(c[0]).toMatchObject({ id: 'atl:26-1', neighborhood: 'Downtown', firearm: false, severity: 0 });
  });
  it('severity and hour histogram', () => {
    expect(crimeSeverity('Robbery')).toBe(2);
    expect(crimeSeverity('theft-from-motor-vehicle')).toBe(1);
    expect(crimeSeverity('Simple assault', true)).toBe(3);
    const h = hourHistogram([{ at: Date.UTC(2026, 10, 17, 3, 0) } as never], 'America/Denver');
    expect(h[20]).toBe(1); // 03:00Z = 20:00 MST
  });
  it('surfaces ArcGIS errors', () => {
    expect(() => parseDenverCrime({ error: { message: 'Token Required' } })).toThrow('Token Required');
  });
});

describe('Denver 311', () => {
  it('parses service requests', () => {
    const r = parseDenver311({ features: [{ attributes: { OBJECTID: 9, Case_Summary: 'Dilapidated Fence', Case_Status: 'Routed to Agency', Agency: 'Community Planning & Development', Case_Created_Date: 1767225600000, Incident_Address_1: '1537 N Tennyson St', Longitude: -105.044, Latitude: 39.741, Neighborhood: 'West Colfax' } }] });
    expect(r[0]).toMatchObject({ id: 'd311:9', summary: 'Dilapidated Fence', address: '1537 N Tennyson St' });
  });
});

describe('NASA FIRMS', () => {
  const csv = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n39.80,-105.10,330,0.4,0.4,2026-11-16,0915,N20,nominal,2.0NRT,290,12.5,N\n39.81,-105.11,310,0.4,0.4,2026-11-16,0915,N20,low,2.0NRT,280,1.0,N\n37.18,-77.45,305,0.4,0.4,2026-11-15,0701,N20,nominal,2.0NRT,275,2.0,N';
  it('keeps confident detections near the city', () => {
    const h = parseFirms(csv, denver, 75);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ satellite: 'N20', frp: 12.5, day: false, at: Date.UTC(2026, 10, 16, 9, 15) });
  });
  it('handles an empty file', () => {
    expect(parseFirms('latitude,longitude,acq_date\n', denver, 75)).toEqual([]);
  });
});

describe('earthquakes', () => {
  it('filters by distance and magnitude', () => {
    const q = parseQuakes(
      { features: [
        { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [-105.0, 39.9, 5] }, properties: { mag: 3.2, place: 'near Boulder', time: 2, url: 'u' } },
        { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [-150, 61, 5] }, properties: { mag: 4, place: 'Alaska', time: 1 } },
        { type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [-105.0, 39.8, 5] }, properties: { mag: 0.9, time: 3 } },
      ] },
      denver,
    );
    expect(q.map((x) => x.id)).toEqual(['eq:a']);
    expect(quakeSeverity(q[0])).toBe(2);
  });
});

describe('FBI wanted', () => {
  it('parses items', () => {
    const w = parseWanted({ items: [{ uid: 'x1', title: 'JOSE DEL CARMEN GARCIA MARTINEZ', poster_classification: 'default', subjects: ['ViCAP Unidentified Persons'], reward_text: '<p>Up to $10,000</p>', caution: '<p>Armed &amp; dangerous</p>', images: [{ thumb: 'https://www.fbi.gov/t.jpg' }], url: 'https://www.fbi.gov/wanted/x', publication: '2026-10-01T00:00:00' }] });
    expect(w[0]).toMatchObject({ id: 'fbi:x1', title: 'Jose Del Carmen Garcia Martinez', reward: 'Up to $10,000', caution: 'Armed & dangerous', image: 'https://www.fbi.gov/t.jpg' });
  });
});

describe('river gauges', () => {
  it('parses NWPS gauges and flood categories', () => {
    const g = parseGauges({ gauges: [{ lid: 'BBCC2', name: 'Bear Creek at Evergreen', latitude: 39.63, longitude: -105.32, status: { observed: { primary: 1.02, primaryUnit: 'ft', floodCategory: 'minor' }, forecast: { floodCategory: '' } } }, { lid: 'X', name: 'Dry', latitude: 1, longitude: 1, status: { observed: { primary: -999, floodCategory: 'no_flooding' } } }] });
    expect(g[0]).toMatchObject({ id: 'nwps:BBCC2', category: 'minor', stage: 1.02, url: 'https://water.noaa.gov/gauges/bbcc2' });
    expect(gaugeSeverity(g[0])).toBe(2);
    expect(g[1].stage).toBeNull();
  });
});

describe('air quality', () => {
  it('parses Open-Meteo current values', () => {
    const a = parseAir({ current: { time: '2026-11-17T04:00', us_aqi: 163, pm2_5: 70, ozone: 11 } })!;
    expect(a).toMatchObject({ aqi: 163, label: 'Unhealthy' });
    expect(airSeverity(a)).toBe(2);
    expect(parseAir({})).toBeNull();
  });
});

describe('FAA airport status', () => {
  it('extracts delays for watched airports', () => {
    const xml = `<AIRPORT_STATUS_INFORMATION><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour</Avg><Max>5 hours</Max></Ground_Delay><Ground_Delay><ARPT>ATL</ARPT><Reason>thunderstorms</Reason><Avg>45 minutes</Avg><Max>2 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type><Delay_type><Name>Ground Stops</Name><Ground_Stop_List><Program><ARPT>DEN</ARPT><Reason>snow</Reason><End_Time>5:00 pm EST</End_Time></Program></Ground_Stop_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
    const d = parseAirportStatus(xml, ['ATL', 'DEN']);
    expect(d.map((x) => [x.airport, x.kind])).toEqual([['ATL', 'Ground delay program'], ['DEN', 'Ground stop']]);
  });
});

describe('storm reports', () => {
  it('parses IEM LSR GeoJSON near the city', () => {
    const r = parseLsr({ features: [{ properties: { product_id: 'p1', typetext: 'TSTM WND DMG', magnitude: '60', unit: 'MPH', city: '2 N Decatur', lon: -84.3, lat: 33.8, valid: '2026-11-16T22:00:00Z', source: 'Public' } }, { properties: { product_id: 'p2', typetext: 'RAIN', lon: -108.5, lat: 37.4, valid: '2026-11-15T14:00:00Z' } }] }, atlanta, 25);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'Tstm Wnd Dmg', city: '2 N Decatur' });
    expect(stormSeverity(r[0])).toBe(2);
  });
});

describe('USGS river cameras', () => {
  const cam = { camId: 'CO_Clear_Creek_at_Golden', camName: 'Clear Creek at Golden', lat: '39.75', lng: '-105.22', newestImageDT: new Date(Date.now() - 600_000).toISOString(), smallDir: 'https://usgs-nims-images.s3.amazonaws.com/720/CO_Clear_Creek_at_Golden/' };
  it('builds the newest image URL', () => {
    expect(usgsImageUrl({ ...cam, newestImageDT: '2026-11-17T00:00:00.000Z' })).toBe('https://usgs-nims-images.s3.amazonaws.com/720/CO_Clear_Creek_at_Golden/CO_Clear_Creek_at_Golden___2026-11-17T00-00-00Z.jpg');
  });
  it('keeps nearby, recently active cameras', () => {
    const c = parseUsgsCams([cam, { ...cam, camId: 'old', newestImageDT: '2025-01-01T00:00:00.000Z' }, { ...cam, camId: 'far', lat: '33', lng: '-84' }], denver, 40);
    expect(c.map((x) => x.id)).toEqual(['usgs:CO_Clear_Creek_at_Golden']);
    expect(c[0].provider).toBe('usgs');
  });
});

describe('AIS', () => {
  it('merges position and static messages per MMSI', () => {
    const ships = new Map<string, Ship>();
    applyAis(ships, JSON.stringify({ MessageType: 'PositionReport', MetaData: { MMSI: 367000001, ShipName: 'TUG ONE  ', latitude: 32.08, longitude: -81.09, time_utc: '2026-11-17 04:00:00.000000000 +0000 UTC' }, Message: { PositionReport: { Sog: 6.2, Cog: 90, TrueHeading: 511, NavigationalStatus: 0 } } }));
    const s = applyAis(ships, JSON.stringify({ MessageType: 'ShipStaticData', MetaData: { MMSI: 367000001, latitude: 32.081, longitude: -81.089 }, Message: { ShipStaticData: { Type: 52, Name: 'TUG ONE' } } }))!;
    expect(s).toMatchObject({ mmsi: '367000001', name: 'TUG ONE', sog: 6.2, heading: null, type: 52 });
    expect(applyAis(ships, 'not json')).toBeNull();
  });
});
