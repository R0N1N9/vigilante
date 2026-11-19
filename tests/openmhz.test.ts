import { describe, expect, it } from 'vitest';
import { callsUrl, nearSystems, newerUrl, parseCalls, parseSystems, parseTalkgroups } from '../src/lib/openmhz';
import hosts from '../config/hosts.json';

describe('OpenMHz live scanner', () => {
  const systems = parseSystems({
    systems: [
      { shortName: 'denver', name: 'Denver Metro', city: 'Denver', state: 'CO', active: true, callAvg: 40, clientCount: 20 },
      { shortName: 'boulder', name: 'Boulder County', city: 'Boulder', state: 'Colorado', active: true, callAvg: 90, clientCount: 5 },
      { shortName: 'old', name: 'Old', state: 'CO', active: false },
      { shortName: 'dc', name: 'DC', state: 'District of Columbia', active: true },
      { name: 'no id' },
    ],
  });

  it('lists active systems in the state, city match first, with state names or codes', () => {
    expect(systems).toHaveLength(4);
    expect(nearSystems(systems, { name: 'Denver', region: 'CO' }).map((s) => s.shortName)).toEqual(['denver', 'boulder']);
    expect(nearSystems(systems, { name: 'Washington', region: 'DC' }).map((s) => s.shortName)).toEqual(['dc']);
  });

  it('parses calls oldest first and keeps milliseconds for the next poll', () => {
    const calls = parseCalls({
      calls: [
        { _id: 'b', url: 'https://media.example/b.m4a', time: '2026-11-19T16:00:05.250Z', len: 4, talkgroupNum: 2, emergency: true },
        { _id: 'a', url: 'https://media.example/a.m4a', time: '2026-11-19T16:00:01.000Z', len: 3, talkgroupNum: 1 },
        { _id: 'x', url: 'http://insecure/x.m4a', time: '2026-11-19T16:00:00Z' },
      ],
    });
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']);
    expect(calls[1]).toMatchObject({ emergency: true, talkgroup: 2, at: Date.parse('2026-11-19T16:00:05.250Z') });
    expect(newerUrl('denver', calls[1].at)).toBe(`https://api.openmhz.com/denver/calls/newer?time=${calls[1].at}`);
    expect(callsUrl('a b')).toBe('https://api.openmhz.com/a%20b/calls');
  });

  it('names talkgroups and is an allowed host', () => {
    expect(parseTalkgroups({ talkgroups: { '7': { num: 7, alpha: 'PD DISP', description: 'Police Dispatch' } } })).toEqual({ 7: 'Police Dispatch' });
    expect(JSON.stringify(hosts)).toContain('"api.openmhz.com"');
  });
});
