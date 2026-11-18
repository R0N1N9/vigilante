import { describe, expect, it } from 'vitest';
import { newPosKey } from '../src/lib/poscrypt';
import { decodeClip, encodeClip, mulawDecode, mulawEncode, openAudio, openVoiceMeta, sealAudio, sealVoiceMeta, voiceEvent, VOICE_RATE } from '../src/lib/voice';

describe('voice codec', () => {
  it('µ-law matches G.711 reference points and round-trips closely', () => {
    expect(mulawEncode(0)).toBe(0xff);
    expect(mulawEncode(-1)).toBe(0x7f);
    expect(mulawEncode(32767)).toBe(0x80);
    expect(mulawDecode(0xff)).toBe(0);
    expect(mulawDecode(0x80)).toBe(32124);
    for (const s of [100, -100, 1000, -5000, 12000, 30000]) {
      const back = mulawDecode(mulawEncode(s));
      expect(Math.abs(back - s) / Math.abs(s)).toBeLessThan(0.07);
    }
  });
  it('resamples 48 kHz speech-band audio to 8 kHz and back', () => {
    const inRate = 48000;
    const tone = Float32Array.from({ length: inRate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / inRate));
    const enc = encodeClip(tone, inRate);
    expect(enc.length).toBe(VOICE_RATE);
    const out = decodeClip(enc, 24000);
    expect(out.length).toBe(24000);
    // Loudness normalised up to ~0.9 peak; signal survives.
    const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.01);
  });
});

describe('voice sealing', () => {
  it('audio and metadata round-trip; wrong key fails', async () => {
    const k = newPosKey();
    const audio = Uint8Array.from({ length: 4000 }, (_, i) => i & 0xff);
    const sealed = await sealAudio(k, audio);
    expect(await openAudio(k, sealed)).toEqual(audio);
    expect(await openAudio(newPosKey(), sealed)).toBeNull();
    const meta = { v: 1 as const, id: 'c1', n: 'Unit 7', byId: 'web-7', t: 5, ms: 2400, sr: 8000 as const, c: 'mulaw' as const };
    const text = await sealVoiceMeta(k, meta);
    expect(text.startsWith('VGV1.')).toBe(true);
    expect(await openVoiceMeta(k, text)).toEqual(meta);
    expect(await openVoiceMeta(k, await sealVoiceMeta(k, { ...meta, c: 'opus' as never }))).toBeNull();
  });
  it('reads ntfy attachment events', () => {
    expect(voiceEvent(JSON.stringify({ id: 'a', event: 'message', message: 'VGV1.x', attachment: { url: 'https://ntfy.sh/file/a.vgv', expires: 9 } }))).toEqual({ id: 'a', message: 'VGV1.x', url: 'https://ntfy.sh/file/a.vgv', expires: 9 });
    expect(voiceEvent(JSON.stringify({ id: 'b', event: 'message', message: 'hi' }))).toBeNull();
    expect(voiceEvent('nope')).toBeNull();
  });
});
