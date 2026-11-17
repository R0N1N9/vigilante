import { describe, expect, it } from 'vitest';
import { inviteCode, inviteLink, meshText, nativeLink, newMeshChannel, newNtfyChannel, ntfyAppLink, ntfyPublishBody, ntfyStreamUrl, ntfyToMessage, parseInvite, parseSpot, randomTopic, spotUrl } from '../src/lib/comms';

describe('invites', () => {
  it('round-trips an ntfy channel through a link, with or without the token', () => {
    const ch = newNtfyChannel({ name: 'North patrol', topic: 'vg-team-abc123', token: 'tk_secret' });
    const back = parseInvite(inviteLink(ch));
    expect(back).toMatchObject({ kind: 'ntfy', name: 'North patrol', server: 'https://ntfy.sh', topic: 'vg-team-abc123', token: 'tk_secret' });
    expect(parseInvite(inviteCode(ch, false))).toMatchObject({ token: '' });
    expect(back!.id).not.toBe(ch.id);
  });
  it('round-trips a mesh channel and keeps only real Meshtastic links', () => {
    const ch = newMeshChannel({ name: 'Ops mesh', channelIndex: 2, inviteUrl: 'https://meshtastic.org/e/#CgMSAQESBggBQANIAQ' });
    expect(parseInvite(inviteCode(ch))).toMatchObject({ kind: 'mesh', name: 'Ops mesh', channelIndex: 2, inviteUrl: ch.inviteUrl });
    const evil = inviteCode(newMeshChannel({ inviteUrl: 'https://evil.example/e/#x' }));
    expect(parseInvite(evil)).toMatchObject({ inviteUrl: '' });
  });
  it('accepts plain ntfy and Meshtastic links', () => {
    expect(parseInvite('https://ntfy.example.org/my_topic')).toMatchObject({ kind: 'ntfy', server: 'https://ntfy.example.org', topic: 'my_topic' });
    expect(parseInvite('ntfy://ntfy.sh/abc-1')).toMatchObject({ kind: 'ntfy', topic: 'abc-1' });
    expect(parseInvite('https://meshtastic.org/e/#CgMSAQE')).toMatchObject({ kind: 'mesh' });
    expect(parseInvite('hello world')).toBeNull();
    expect(parseInvite('VG1.notbase64!!')).toBeNull();
  });
  it('rejects non-https servers and odd topics inside codes', () => {
    const bad = `VG1.${btoa(JSON.stringify({ v: 1, k: 'ntfy', n: 'x', s: 'http://ntfy.sh', t: 'ok' })).replace(/=+$/, '')}`;
    expect(parseInvite(bad)).toBeNull();
    const bad2 = `VG1.${btoa(JSON.stringify({ v: 1, k: 'ntfy', n: 'x', s: 'https://ntfy.sh', t: '../admin' })).replace(/=+$/, '')}`;
    expect(parseInvite(bad2)).toBeNull();
  });
  it('builds native links', () => {
    const ch = newNtfyChannel({ topic: 't1' });
    expect(nativeLink(ch)).toBe('https://ntfy.sh/t1');
    expect(ntfyAppLink(ch)).toBe('ntfy://ntfy.sh/t1');
    expect(randomTopic()).toMatch(/^vg-team-[a-z0-9]{18}$/);
  });
});

describe('spots and messages', () => {
  it('parses spots from links and text', () => {
    expect(parseSpot('', spotUrl({ lat: 39.7392, lon: -104.9903 }))).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(parseSpot('meet here @33.74901,-84.38798')).toEqual({ lat: 33.74901, lon: -84.38798 });
    expect(parseSpot('geo:39.1,-104.2')).toEqual({ lat: 39.1, lon: -104.2 });
    expect(parseSpot('no location here, version 1.2345')).toBeNull();
  });
  it('fits mesh text into 200 bytes with the location tag', () => {
    const t = meshText('x'.repeat(400), { lat: 39.7, lon: -104.9 });
    expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(200);
    expect(t.endsWith('@39.70000,-104.90000')).toBe(true);
  });
  it('maps ntfy events, recognising our own echo', () => {
    const ch = newNtfyChannel();
    const e = { id: 'abc', time: 1700000000, event: 'message', topic: ch.topic, title: 'Unit 7', message: 'On scene @39.70000,-104.90000', tags: ['vigilante', 'vg-me123'] };
    const mine = ntfyToMessage(e, ch.id, 'me123')!;
    expect(mine).toMatchObject({ id: 'ntfy:abc', from: 'Unit 7', mine: true, at: 1700000000000, spot: { lat: 39.7, lon: -104.9 } });
    expect(ntfyToMessage({ ...e, tags: [] }, ch.id, 'me123')!.mine).toBe(false);
    expect(ntfyToMessage({ ...e, title: undefined, tags: undefined }, ch.id, 'x')!.from).toBe('ntfy app');
    expect(ntfyToMessage({ ...e, event: 'keepalive' }, ch.id, 'x')).toBeNull();
  });
  it('publishes with tags, title and a map action', () => {
    const ch = newNtfyChannel({ topic: 't' });
    const b = ntfyPublishBody(ch, 'Unit 7', 'hi', 'me', { lat: 1, lon: 2 });
    expect(b).toMatchObject({ topic: 't', title: 'Unit 7', message: 'hi', tags: ['vigilante', 'vg-me'] });
    expect(b.click).toContain('mlat=1.00000');
    expect(ntfyStreamUrl({ ...ch, token: 'tk_1' }, '24h')).toMatch(/\/t\/sse\?since=24h&auth=[A-Za-z0-9_-]+$/);
  });
});
