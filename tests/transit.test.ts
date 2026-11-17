import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseGtfsZip, routeName } from '../src/lib/gtfs';
import { decodeAlerts, decodeTripUpdates, decodeVehicles, isActive } from '../src/lib/gtfsrt';
import { Writer } from '../src/lib/protobuf';
import { martaDisruptions, rtdDisruptions } from '../src/lib/transit';

const ts = (s: string) => new Writer().message(1, new Writer().string(1, s).string(2, 'en'));
const now = 1_800_000_000;

function feed(entities: Writer[]): Uint8Array {
  const w = new Writer().message(1, new Writer().string(1, '2.0').uint(3, now));
  entities.forEach((e) => w.message(2, e));
  return w.finish();
}

function alert(id: string, cause: number, effect: number, stops: string[], route: string, header: string, start = now - 600, end = now + 3600) {
  const a = new Writer().message(1, new Writer().uint(1, start).uint(2, end));
  stops.forEach((s) => a.message(5, new Writer().string(1, 'RTD').string(2, route).string(5, s)));
  a.uint(6, cause).uint(7, effect).message(10, ts(header)).message(11, ts(`${header}. More details.`));
  return new Writer().string(1, id).message(5, a);
}

const gtfs = parseGtfsZip(
  zipSync({
    'stops.txt': strToU8('stop_id,stop_name,stop_lat,stop_lon\r\n100,"Colfax Ave & Broadway",39.7400,-104.9875\r\n200,Far Away Stop,40.5,-105.5\r\n'),
    'routes.txt': strToU8('route_id,route_short_name,route_long_name,route_type\n15,15,East Colfax,3\nW,W,West Line,0\n'),
  }),
);

describe('GTFS static', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([{ a: 'x, y', b: 'say "hi"' }]);
  });
  it('reads stops and routes from a zip', () => {
    expect(gtfs.stops['100']).toEqual({ name: 'Colfax Ave & Broadway', at: [-104.9875, 39.74] });
    expect(routeName(gtfs, '15')).toBe('Bus 15');
    expect(routeName(gtfs, 'W')).toBe('W (light rail)');
  });
});

describe('RTD service alerts', () => {
  const alerts = decodeAlerts(
    feed([
      alert('a1', 11, 4, ['100'], '15', 'Detour due to police activity at Colfax & Broadway'),
      alert('a2', 10, 1, ['100'], '15', 'Stop closed for construction'),
      alert('a3', 6, 1, ['200'], '15', 'Accident far away'),
      alert('a4', 8, 3, [], 'W', 'Weather delays on the W Line', now - 7200, now - 3600),
    ]),
  );

  it('decodes alert fields', () => {
    expect(alerts[0]).toMatchObject({ id: 'a1', cause: 11, effect: 4, routes: ['15'], stops: ['100'], header: 'Detour due to police activity at Colfax & Broadway' });
    expect(isActive(alerts[3], now)).toBe(false);
  });

  it('keeps active alerts in the area, located at their stops, police activity first', () => {
    const d = rtdDisruptions(alerts, gtfs, [-104.9903, 39.7392], 25, now);
    expect(d.map((x) => x.id)).toEqual(['rtd:a1', 'rtd:a2']);
    expect(d[0]).toMatchObject({ severity: 2, cause: 'Police activity', effect: 'Detour', title: 'Bus 15', location: [-104.9875, 39.74] });
    expect(d[1].severity).toBe(0); // planned construction is not an alert
  });
});

describe('MARTA delays', () => {
  const tu = (trip: string, route: string, vehicle: string, delay: number) =>
    new Writer().string(1, `e${trip}`).message(
      3,
      new Writer()
        .message(1, new Writer().string(1, trip).string(5, route))
        .message(3, new Writer().string(1, vehicle))
        .message(2, new Writer().uint(1, 1).message(2, new Writer().uint(2, now + delay).uint(4, now)).string(4, 'S1')),
    );
  const vp = (id: string, trip: string, route: string, lat: number, lon: number) =>
    new Writer().string(1, `v${id}`).message(4, new Writer().message(1, new Writer().string(1, trip).string(5, route)).message(2, new Writer().float(1, lat).float(2, lon)).message(8, new Writer().string(1, id).string(2, id)));

  const updates = decodeTripUpdates(feed([tu('t1', '110', 'b1', 1200), tu('t2', '110', 'b2', 1500), tu('t3', '110', 'b3', 60), tu('t4', '39', 'b4', 1300), tu('t5', '110', 'b5', 50_000)]));
  const vehicles = decodeVehicles(feed([vp('b1', 't1', '110', 33.76, -84.38), vp('b2', 't2', '110', 33.77, -84.38), vp('b3', 't3', '110', 33.75, -84.39), vp('b4', 't4', '39', 33.8, -84.3), vp('b5', 't5', '110', 33.75, -84.39)]));

  it('computes delay from predicted minus scheduled time', () => {
    expect(updates.map((u) => u.delaySec)).toEqual([1200, 1500, 60, 1300, 50_000]);
    expect(vehicles[0].lat).toBeCloseTo(33.76, 4);
  });

  it('flags routes with several late buses, ignoring absurd delays', () => {
    const d = martaDisruptions(updates, vehicles, null, [-84.388, 33.749], 25);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: 'marta:delay:110', agency: 'MARTA' });
    expect(d[0].detail).toBe('2 buses running 15+ min late (worst 25 min)');
    expect(d[0].points).toHaveLength(2);
  });
});
