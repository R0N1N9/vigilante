import { describe, expect, it } from 'vitest';
import { newPosKey, openPosition, sealPosition, type PositionReport } from '../src/lib/poscrypt';
import { isJpeg, openPhotoMeta, sealPhotoMeta } from '../src/lib/photo';
import { describeDevice, describeListening, deviceFromUA, freqText, initials, memberColor, MEMBER_COLORS, parseFreq, reconName, teamFreqs } from '../src/lib/teamext';

describe('frequencies (Vigil-compatible chat lines)', () => {
  it('formats and parses both ways', () => {
    const t = freqText(462.5625, 'NFM', '67.0', 'Team channel', 'Unit 7');
    expect(t).toBe('📻 FREQ 462.5625 MHz NFM · tone 67.0 · Team channel — Unit 7');
    expect(parseFreq(t)).toMatchObject({ mhz: 462.5625, mode: 'NFM', tone: '67.0', label: 'Team channel', by: 'Unit 7' });
    expect(parseFreq('📻 FREQ 155.34 MHz', 'Ops', 5)).toMatchObject({ mhz: 155.34, mode: '', tone: '', label: '', by: 'Ops' });
    expect(parseFreq('hello')).toBeNull();
  });
  it('keeps the newest per frequency and mode', () => {
    const chat = [
      { text: freqText(462.5625, 'NFM', '', 'Old', 'A'), from: 'A', at: 1 },
      { text: freqText(462.5625, 'NFM', '', 'New', 'B'), from: 'B', at: 2 },
      { text: freqText(146.52, 'FM', '', '', 'C'), from: 'C', at: 3 },
    ];
    expect(teamFreqs(chat).map((f) => f.label || f.mhz)).toEqual([146.52, 'New']);
  });
});

describe('member colours and initials', () => {
  it('matches Vigil (FNV-1a over the device id)', () => {
    // FNV-1a("vigil-3f9a2c") mod 10, computed independently.
    let h = 0x811c9dc5;
    for (const c of 'vigil-3f9a2c') h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    expect(memberColor('vigil-3f9a2c')).toBe(MEMBER_COLORS[h % 10]);
    expect(memberColor('x')).toBe(memberColor('x'));
    expect(initials('Unit 7')).toBe('U7');
    expect(initials('bravo')).toBe('BR');
    expect(initials('  ')).toBe('?');
  });
});

describe('device and radio report fields', () => {
  it('reads iPhone and Android browsers', () => {
    expect(deviceFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toEqual({ type: 'web', os: 'iOS 18', model: 'Safari' });
    expect(deviceFromUA('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')).toEqual({ type: 'web', os: 'Android 15', model: 'Chrome' });
    expect(describeDevice(undefined, 'vigil')).toBe('Android (Vigil app)');
    expect(describeDevice({ type: 'android', os: 'Android 15', model: 'Google Pixel 8' }, 'vigil')).toBe('Android 15 · Google Pixel 8');
    expect(describeListening({ f: 462.5625, mode: 'NFM', label: 'Team', sysName: 'Chicago Fire' })).toBe('462.5625 MHz NFM (Team) · scanner: Chicago Fire');
  });
  it('keeps radio/dev only when the sender opted in', async () => {
    const k = newPosKey();
    const base: PositionReport = { v: 1, id: 'vigil-1', n: 'A', t: 1, s: 'on', perm: ['loc', 'radio', 'device'], lat: 1, lon: 2, radio: { f: 462.5625, mode: 'NFM', sys: 'chi_cfd', sysName: 'Chicago Fire' }, dev: { type: 'android', os: 'Android 15', model: 'Pixel 8' } };
    const got = await openPosition(k, await sealPosition(k, base));
    expect(got?.radio).toEqual({ f: 462.5625, mode: 'NFM', sys: 'chi_cfd', sysName: 'Chicago Fire' });
    expect(got?.dev).toEqual({ type: 'android', os: 'Android 15', model: 'Pixel 8' });
    const off = await openPosition(k, await sealPosition(k, { ...base, perm: ['loc'] }));
    expect(off?.radio).toBeUndefined();
    expect(off?.dev).toBeUndefined();
  });
});

describe('photos (VGI1)', () => {
  it('round-trips metadata and validates', async () => {
    const k = newPosKey();
    const m = { v: 1 as const, id: 'p8k2m1x0', n: 'Unit 7', byId: 'vigil-3f9a2c', t: 5, lat: 39.748, lon: -104.995, mark: 'm7q2xk', cap: 'Gate chained shut', w: 1600, h: 1200, mime: 'image/jpeg' as const };
    const text = await sealPhotoMeta(k, m);
    expect(text.startsWith('VGI1.')).toBe(true);
    expect(await openPhotoMeta(k, text)).toEqual(m);
    expect(await openPhotoMeta(k, await sealPhotoMeta(k, { ...m, mime: 'image/png' as never }))).toBeNull();
    const badLoc = await openPhotoMeta(k, await sealPhotoMeta(k, { ...m, lat: 120 }));
    expect(badLoc?.lat).toBeUndefined();
    expect(isJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(reconName('the north gate')).toBe('Recon: the north gate');
    expect(reconName('')).toBe('Recon: this spot');
  });
});
