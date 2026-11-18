import { describe, expect, it } from 'vitest';
import { isPosKey, newPosKey, openPosition, posTopic, sealPosition, type PositionReport } from '../src/lib/poscrypt';
import { fieldCodeOf, fieldLink, inviteCode, newNtfyChannel, parseInvite } from '../src/lib/comms';

const r: PositionReport = { v: 1, id: 'dev1', n: 'Unit 7', lat: 39.7392, lon: -104.9903, acc: 8, spd: 1.2, t: 1700000000000, s: 'on' };

describe('encrypted positions', () => {
  it('round-trips with the right key only', async () => {
    const k = newPosKey();
    expect(isPosKey(k)).toBe(true);
    const sealed = await sealPosition(k, r);
    expect(sealed).toMatch(/^VGP1\./);
    expect(sealed).not.toContain('39.7');
    expect(await openPosition(k, sealed)).toEqual(r);
    expect(await openPosition(newPosKey(), sealed)).toBeNull();
  });
  it('rejects tampering and junk', async () => {
    const k = newPosKey();
    const sealed = await sealPosition(k, r);
    const at = sealed.length - 2;
    const flipped = sealed.slice(0, at) + (sealed[at] === 'A' ? 'B' : 'A') + sealed.slice(at + 1);
    expect(await openPosition(k, flipped)).toBeNull();
    expect(await openPosition(k, 'hello')).toBeNull();
    expect(await openPosition(k, 'VGP1.AAAA')).toBeNull();
  });
  it('rejects out-of-range coordinates even when sealed correctly', async () => {
    const k = newPosKey();
    expect(await openPosition(k, await sealPosition(k, { ...r, lat: 120 }))).toBeNull();
  });
  it('uses a sibling topic', () => expect(posTopic('vg-team-x')).toBe('vg-team-x-pos'));
});

describe('phone check-in invites', () => {
  it('carries the position key through invites and the field link', () => {
    const ch = newNtfyChannel({ topic: 'vg-team-abc' });
    expect(isPosKey(ch.posKey)).toBe(true);
    expect(parseInvite(inviteCode(ch))).toMatchObject({ posKey: ch.posKey });
    const link = fieldLink(ch);
    expect(link).toMatch(/\?view=field#join=VG1\./);
    expect(parseInvite(link)).toMatchObject({ topic: 'vg-team-abc', posKey: ch.posKey });
  });
  it('drops an invalid key from an invite', () => {
    const code = `VG1.${btoa(JSON.stringify({ v: 1, k: 'ntfy', n: 'x', s: 'https://ntfy.sh', t: 'ok', p: 'short' })).replace(/=+$/, '')}`;
    expect(parseInvite(code)).toMatchObject({ posKey: '' });
  });
  it('recognises status codes', () => {
    expect(fieldCodeOf('🚨 EMERGENCY — Unit 7')).toBe('sos');
    expect(fieldCodeOf('⚠ NEED BACKUP — Unit 7')).toBe('backup');
    expect(fieldCodeOf('⚠ Severe thunderstorm warning')).toBeNull();
  });
});
