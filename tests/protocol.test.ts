import { describe, expect, it } from 'vitest';
import { openPosition, sealPosition, type PositionReport } from '../src/lib/poscrypt';
import { parseInvite, vigilLink, fieldCodeOf } from '../src/lib/comms';

// Test vectors from docs/TEAM_PROTOCOL.md. The Vigil app must produce and accept the same bytes.
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const SEALED = 'VGP1.oKGio6SlpqeoqaqrnToKD3_6Lp0LAaXpJQypuRnAdCP0jiNe_ywKpBGJTyOHGC6LjxVxEX39dLgrQKGPLnwvJED8OAgkLClkhkGrgpqMp0MS1YGSmcDFQ62io9nvJ4nGpLW7VswYUe7Y9SO20qgJx2LaraGt4ihntrHfBAY8DsD8D7YNH_vwnY1lwWHncNMc8Xi4OxUqju8wcKD4vPWPA9q32LbE_5HXzaZACfwvKZ2UCShxoDBNQwOh081VR57sIFyMSePuHVAy5T17FkJu81Hmjd7HbXD_eRQChWLFxpsdWfrXg-MlOIQF2dum6Ojq4dYkz52Pmg';
const INVITE = 'VG1.eyJ2IjoxLCJrIjoibnRmeSIsIm4iOiJOb3J0aCBwYXRyb2wiLCJzIjoiaHR0cHM6Ly9udGZ5LnNoIiwidCI6InZnLXRlYW0tazJtOXg0cTdyMXA4dzN6NWM2IiwicCI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHhBUkVoTVVGUllYR0JrYUd4d2RIaDgifQ';

describe('team protocol test vectors', () => {
  it('opens the reference report', async () => {
    const r = await openPosition(KEY, SEALED);
    expect(r).toMatchObject({ v: 1, id: 'vigil-3f9a2c', n: 'Unit 7', app: 'vigil', perm: ['loc', 'bat', 'motion'], lat: 39.7392, lon: -104.9903, bat: 76, act: 'walking', s: 'on' });
  });
  it('parses the reference invite and builds the Vigil deep link', () => {
    const ch = parseInvite(INVITE)!;
    expect(ch).toMatchObject({ kind: 'ntfy', name: 'North patrol', server: 'https://ntfy.sh', topic: 'vg-team-k2m9x4q7r1p8w3z5c6', posKey: KEY });
    expect(parseInvite(`https://r0n1n9.github.io/vigilante/?view=field#join=${INVITE}`)).toMatchObject({ posKey: KEY });
    expect(parseInvite(`vigil://join?code=${INVITE}`)).toMatchObject({ posKey: KEY });
    expect(vigilLink(ch)).toMatch(/^vigil:\/\/join\?code=VG1\./);
  });
  it('drops categories the sender did not opt into', async () => {
    const leaky: PositionReport = { v: 1, id: 'x', n: 'A', perm: ['bat'], lat: 39, lon: -104, bat: 50, hr: 120, act: 'driving', t: 1, s: 'on' };
    const r = await openPosition(KEY, await sealPosition(KEY, leaky));
    expect(r).toMatchObject({ bat: 50 });
    expect(r!.lat).toBeUndefined();
    expect(r!.hr).toBeUndefined();
    expect(r!.act).toBeUndefined();
  });
  it('dark keeps nothing but identity and time', async () => {
    const r = await openPosition(KEY, await sealPosition(KEY, { v: 1, id: 'x', n: 'A', perm: ['loc'], lat: 39, lon: -104, t: 5, s: 'dark' }));
    expect(r).toEqual({ v: 1, id: 'x', n: 'A', t: 5, s: 'dark', app: undefined });
  });
  it('presence-only reports are valid', async () => {
    const r = await openPosition(KEY, await sealPosition(KEY, { v: 1, id: 'x', n: 'A', perm: ['bat'], bat: 40, t: 1, s: 'on' }));
    expect(r).toMatchObject({ bat: 40 });
  });
  it('knows the fall code', () => expect(fieldCodeOf('🚨 FALL DETECTED — Unit 7')).toBe('fall'));
});
