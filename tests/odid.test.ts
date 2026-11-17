import { describe, expect, it } from 'vitest';
import { decodeServiceData, encodeBasic, encodeLocation, encodePack, encodeSystem, hexToBytes, wrapServiceData } from '../src/lib/odid';

describe('Open Drone ID', () => {
  it('round-trips a message pack inside Bluetooth service data', () => {
    const frame = encodePack([
      encodeBasic('1581F5FHC23400ABCDEF'),
      encodeLocation({ lat: 39.7392, lon: -104.9903, altGeoM: 1700, heightM: 95, speedMs: 6.5, directionDeg: 270 }),
      encodeSystem(39.738, -104.991),
    ]);
    const msgs = decodeServiceData(wrapServiceData(frame, 7));
    expect(msgs.map((m) => m.type)).toEqual(['basic', 'location', 'system']);
    const [basic, loc, sys] = msgs as any[];
    expect(basic.uasId).toBe('1581F5FHC23400ABCDEF');
    expect(basic.uaType).toBe(2);
    expect(loc.lat).toBeCloseTo(39.7392, 6);
    expect(loc.lon).toBeCloseTo(-104.9903, 6);
    expect(loc.heightM).toBeCloseTo(95, 0);
    expect(loc.directionDeg).toBe(270);
    expect(loc.speedMs).toBeCloseTo(6.5, 1);
    expect(sys.operatorLat).toBeCloseTo(39.738, 6);
  });

  it('decodes a single location message without a pack', () => {
    const m = decodeServiceData(wrapServiceData(encodeLocation({ lat: 33.749, lon: -84.388, altGeoM: 400, heightM: 60, speedMs: 100, directionDeg: 10 }), 1));
    expect(m[0]).toMatchObject({ type: 'location', directionDeg: 10 });
    expect((m[0] as any).speedMs).toBeCloseTo(100, 0);
  });

  it('ignores junk', () => {
    expect(decodeServiceData(hexToBytes('0d01ff'))).toEqual([]);
  });
});
