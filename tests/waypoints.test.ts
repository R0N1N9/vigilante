import { describe, expect, it } from 'vitest';
import { deviceOf, directionsLinks, isFor, markFromWire, markLive, markToWire, openOps, PING_TTL_S, reached, sealOps, toWire, type Mark, type Waypoint } from '../src/lib/waypoints';
import { newPosKey, openPosition } from '../src/lib/poscrypt';

const w: Waypoint = { id: 'w1', channelId: 'c1', name: 'North gate', note: 'Meet here', location: [-104.995, 39.748], to: ['dev-a'], priority: 'urgent', state: 'active', by: 'Ops', at: 1, acks: {} };

describe('waypoints', () => {
  it('round-trips waypoints and replies through the sealed ops format', async () => {
    const k = newPosKey();
    const sealed = await sealOps(k, toWire(w));
    expect(sealed).toMatch(/^VGO1\./);
    expect(sealed).not.toContain('North');
    expect(await openOps(k, sealed)).toMatchObject({ type: 'wp', id: 'w1', name: 'North gate', lat: 39.748, lon: -104.995, to: ['dev-a'], pri: 'urgent', state: 'active' });
    const ack = await sealOps(k, { v: 1, type: 'wp-ack', wp: 'w1', id: 'dev-a', n: 'Unit 7', state: 'arrived', t: 2 });
    expect(await openOps(k, ack)).toMatchObject({ type: 'wp-ack', state: 'arrived', n: 'Unit 7' });
    expect(await openOps(newPosKey(), sealed)).toBeNull();
    // Position reports and ops messages can't be confused
    expect(await openPosition(k, sealed)).toBeNull();
  });
  it('rejects malformed ops', async () => {
    const k = newPosKey();
    expect(await openOps(k, await sealOps(k, { ...toWire(w), lat: 200 } as never))).toBeNull();
    expect(await openOps(k, await sealOps(k, { v: 1, type: 'wp-ack', wp: 'w1', id: 'x', n: 'y', state: 'teleported', t: 1 } as never))).toBeNull();
  });
  it('addressing, arrival and directions', () => {
    expect(isFor({ to: [] }, 'anyone')).toBe(true);
    expect(isFor(w, 'dev-a')).toBe(true);
    expect(isFor(w, 'dev-b')).toBe(false);
    expect(reached(w, [-104.9952, 39.7481])).toBe(true);
    expect(reached(w, [-104.99, 39.748])).toBe(false);
    expect(reached(w, null)).toBe(false);
    const d = directionsLinks(39.748, -104.995, 'North gate');
    expect(d.google).toContain('destination=39.748000,-104.995000');
    expect(d.androidNav).toBe('google.navigation:q=39.748000,-104.995000');
    expect(d.geo).toContain('(North%20gate)');
    expect(deviceOf('phone:c1:dev-a')).toBe('dev-a');
    expect(deviceOf('mesh:123')).toBeNull();
  });
});

describe('marks', () => {
  it('round-trips every kind, clamps and defaults', async () => {
    const k = newPosKey();
    const area = { v: 1 as const, type: 'mark' as const, id: 'm1', kind: 'area' as const, cat: 'hazard' as const, name: 'Downed line', desc: 'Keep clear', lat: 39.748, lon: -104.995, r: 99999, state: 'active' as const, by: 'Unit 7', byId: 'vigil-1', t: 5 };
    const got = await openOps(k, await sealOps(k, area));
    expect(got).toMatchObject({ type: 'mark', kind: 'area', cat: 'hazard', r: 20000, name: 'Downed line' });
    const ping = await openOps(k, await sealOps(k, { ...area, id: 'p1', kind: 'ping', r: undefined }));
    expect(ping).toMatchObject({ kind: 'ping', ttl: PING_TTL_S });
    expect(await openOps(k, await sealOps(k, { ...area, cat: 'weird' as never }))).toMatchObject({ cat: 'general' });
    expect(await openOps(k, await sealOps(k, { ...area, kind: 'nuke' as never }))).toBeNull();
    expect(await openOps(k, await sealOps(k, { ...area, lat: 99 }))).toBeNull();
  });
  it('wire conversion and liveness', () => {
    const m: Mark = { id: 'x', channelId: 'c', kind: 'objective', cat: 'rally', name: 'Secure lot', desc: '', location: [-105, 39.7], state: 'progress', by: 'Ops', byId: 'lap', at: 1000 };
    expect(markFromWire(markToWire(m), 'c')).toEqual(m);
    expect(markLive({ state: 'active', at: 0, ttlS: 60 }, 30_000)).toBe(true);
    expect(markLive({ state: 'active', at: 0, ttlS: 60 }, 61_000)).toBe(false);
    expect(markLive({ state: 'cleared', at: 0 }, 1)).toBe(false);
    expect(markLive({ state: 'done', at: 0 }, 1e12)).toBe(true);
  });
});
