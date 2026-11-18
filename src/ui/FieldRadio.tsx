/** Phone page walkie-talkie: hold to talk, teammates' clips play as they arrive. */
import { useEffect, useRef, useState } from 'react';
import { ntfyStreamUrl, type NtfyChannel } from '../lib/comms';
import { audioCtx, audioReady, fetchClip, MAX_CLIP_S, openVoiceMeta, playClip, PttRecorder, sendClip, voiceEvent, voiceTopic, type VoiceMeta } from '../lib/voice';
import { Icon } from './Icon';

interface Clip {
  id: string;
  by: string;
  mine: boolean;
  at: number;
  ms: number;
  url: string;
}

const fmtAgo = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

export function FieldRadio({ ch, callsign, deviceId }: { ch: NtfyChannel; callsign: string; deviceId: string }) {
  const rec = useRef<PttRecorder | null>(null);
  const held = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'opening' | 'tx' | 'sending'>('idle');
  const [err, setErr] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [rx, setRx] = useState('');
  const [soundOn, setSoundOn] = useState(audioReady());
  const [txStart, setTxStart] = useState(0);
  const [, tick] = useState(0);
  const pending = useRef<Clip[]>([]);

  const play = async (c: Clip) => {
    const audio = await fetchClip(ch.posKey, c.url);
    if (!audio) return setErr('A clip couldn’t be played (expired or wrong key).');
    setRx(c.by);
    navigator.vibrate?.(60);
    await playClip(audio).catch(() => {});
    setRx('');
  };

  useEffect(() => {
    if (!ch.posKey) return;
    const es = new EventSource(ntfyStreamUrl({ ...ch, topic: voiceTopic(ch.topic) }, '1h'));
    es.onmessage = (e) => {
      const ev = voiceEvent(e.data);
      if (!ev) return;
      void openVoiceMeta(ch.posKey, ev.message).then((m) => {
        if (!m) return;
        const c: Clip = { id: m.id, by: m.n || 'Unknown', mine: m.byId === deviceId, at: m.t, ms: m.ms, url: ev.url };
        setClips((cur) => (cur.some((x) => x.id === c.id) ? cur : [c, ...cur].sort((a, b) => b.at - a.at).slice(0, 20)));
        if (c.mine || Date.now() - c.at > 90_000) return;
        // Browsers only allow sound after a tap; hold fresh clips until then.
        if (audioReady()) void play(c);
        else pending.current.push(c);
      });
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.server, ch.topic, ch.token, ch.posKey, deviceId]);

  useEffect(() => {
    if (phase !== 'tx') return;
    const i = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [phase]);
  useEffect(() => () => rec.current?.release(), []);

  const enableSound = () => {
    audioCtx();
    setSoundOn(true);
    const q = pending.current.splice(0);
    q.forEach((c) => void play(c));
  };

  const down = async () => {
    if (held.current) return;
    held.current = true;
    setErr('');
    if (!soundOn) enableSound();
    rec.current ??= new PttRecorder();
    rec.current.onLimit = () => void up();
    setPhase('opening');
    try {
      await rec.current.start();
      if (!held.current) return void up();
      navigator.vibrate?.(30);
      setTxStart(Date.now());
      setPhase('tx');
    } catch (e) {
      held.current = false;
      setPhase('idle');
      setErr(/denied|NotAllowed/i.test(String(e)) ? 'Microphone blocked. Allow it in your browser’s site settings, then try again.' : String(e instanceof Error ? e.message : e));
    }
  };
  const up = async () => {
    held.current = false;
    const clip = rec.current?.stop();
    if (!clip) return setPhase('idle');
    setPhase('sending');
    const meta: VoiceMeta = { v: 1, id: Math.random().toString(36).slice(2, 12), n: callsign || 'Phone', byId: deviceId, t: clip.t, ms: clip.ms, sr: 8000, c: 'mulaw' };
    try {
      await sendClip(ch, meta, clip.audio);
    } catch (e) {
      setErr(`Not sent: ${String(e instanceof Error ? e.message : e)}`);
    }
    setPhase('idle');
  };

  const secs = phase === 'tx' ? Math.floor((Date.now() - txStart) / 1000) : 0;
  const state = phase === 'tx' || phase === 'opening' ? 'tx' : rx ? 'rx' : phase === 'sending' ? 'busy' : '';
  return (
    <div className="field-card radio-card">
      <div className="marks-head">
        <h3>Radio</h3>
        {!soundOn && (
          <button className="field-btn ping-btn" onClick={enableSound}>
            Turn on sound
          </button>
        )}
      </div>
      <button
        className={`ptt big ${state}`}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          void down();
        }}
        onPointerUp={() => void up()}
        onPointerCancel={() => void up()}
        onContextMenu={(e) => e.preventDefault()}
        disabled={!ch.posKey}
      >
        <Icon name="mic" size={20} />
        <span>{phase === 'tx' ? `Talking… ${secs}s · release to send` : phase === 'opening' ? 'Opening mic…' : phase === 'sending' ? 'Sending…' : rx ? `${rx} is talking` : 'Hold to talk'}</span>
      </button>
      <p className="small-text muted">
        {err ? <span className="crit">{err}</span> : `Everyone on the team hears it, end-to-end encrypted. Up to ${MAX_CLIP_S} s. Keep this page open to hear others.`}
      </p>
      {clips.slice(0, 6).map((c) => (
        <button key={c.id} className="clip-row" onClick={() => void play(c)}>
          <Icon name="play" size={12} />
          <b>{c.mine ? 'You' : c.by}</b>
          <span className="mono muted">
            {(c.ms / 1000).toFixed(1)} s · {fmtAgo(c.at)} ago
          </span>
        </button>
      ))}
    </div>
  );
}
