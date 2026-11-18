/** Push-to-talk on team channels: receive, play, and send voice clips (see lib/voice.ts). */
import type { NtfyChannel } from '../../lib/comms';
import { fetchClip, openVoiceMeta, playClip, sendClip, voiceEvent, voiceTopic, type VoiceMeta } from '../../lib/voice';
import { ntfyStreamUrl } from '../../lib/comms';
import { setShared } from '../bus';
import { getState } from '../store';
import { log } from './core';

export interface VoiceClip {
  id: string;
  channelId: string;
  by: string;
  byId: string;
  at: number;
  ms: number;
  /** Attachment URL (ciphertext); servers delete attachments after a few hours. */
  url: string;
  mine: boolean;
}

const streams = new Map<string, { es: EventSource; key: string }>();
/** Clips fresher than this play on arrival; older ones (history on connect) are only listed. */
const LIVE_MS = 90_000;

function add(c: VoiceClip) {
  const cur = getState().voice;
  if (cur.some((x) => x.id === c.id)) return false;
  setShared({ voice: [c, ...cur].sort((a, b) => b.at - a.at).slice(0, 50) });
  return true;
}

async function hear(ch: NtfyChannel, c: VoiceClip) {
  const audio = await fetchClip(ch.posKey, c.url);
  if (!audio) return log(`TEAM   Voice from ${c.by} couldn't be decrypted`, 1);
  setShared({ voiceRx: { by: c.by, until: Date.now() + c.ms + 600 } });
  await playClip(audio).catch(() => {});
  const rx = getState().voiceRx;
  if (rx && rx.until <= Date.now() + 200) setShared({ voiceRx: null });
}

export function connectVoice(ch: NtfyChannel) {
  const key = `${ch.server}|${ch.topic}|${ch.token}|${ch.posKey}`;
  const cur = streams.get(ch.id);
  if (cur?.key === key) return;
  cur?.es.close();
  if (!ch.posKey) return void streams.delete(ch.id);
  const es = new EventSource(ntfyStreamUrl({ ...ch, topic: voiceTopic(ch.topic) }, '1h'));
  const me = () => getState().settings.team.installId;
  es.onmessage = (e) => {
    const ev = voiceEvent(e.data);
    if (!ev) return;
    void openVoiceMeta(ch.posKey, ev.message).then((m) => {
      if (!m) return;
      const clip: VoiceClip = { id: m.id, channelId: ch.id, by: m.n || 'Unknown', byId: m.byId, at: m.t, ms: m.ms, url: ev.url, mine: m.byId === me() };
      if (!add(clip) || clip.mine) return;
      if (Date.now() - m.t < LIVE_MS) {
        log(`TEAM   Voice · ${clip.by} (${Math.round(clip.ms / 1000)} s)`, 0);
        void hear(ch, clip);
      }
    });
  };
  streams.set(ch.id, { es, key });
}

export function dropVoice(live: Set<string>) {
  for (const [id, st] of streams)
    if (!live.has(id)) {
      st.es.close();
      streams.delete(id);
    }
}

export async function replayClip(c: VoiceClip) {
  const ch = getState().channels.find((x): x is NtfyChannel => x.id === c.channelId && x.kind === 'ntfy');
  if (!ch?.posKey) throw new Error('Channel is gone');
  const audio = await fetchClip(ch.posKey, c.url);
  if (!audio) throw new Error('Clip expired on the server');
  await playClip(audio);
}

/** Send a recorded clip on a channel. */
export async function transmit(channelId: string, audio: Uint8Array, ms: number, t: number) {
  const s = getState();
  const ch = s.channels.find((x): x is NtfyChannel => x.id === channelId && x.kind === 'ntfy');
  if (!ch?.posKey) throw new Error('Pick a team channel with an encryption key.');
  const meta: VoiceMeta = { v: 1, id: Math.random().toString(36).slice(2, 12), n: s.settings.team.callsign || 'Ops', byId: s.settings.team.installId, t, ms, sr: 8000, c: 'mulaw' };
  await sendClip(ch, meta, audio);
}
