import { useEffect, useMemo, useRef, useState } from 'react';
import { replayClip, transmit } from '../data/engine/voice';
import { getState, setState, useStore } from '../data/store';
import type { NtfyChannel } from '../lib/comms';
import { ageText } from '../lib/team';
import { audioCtx, MAX_CLIP_S, PttRecorder } from '../lib/voice';
import { Icon } from './Icon';

const rec = new PttRecorder();
type Phase = 'idle' | 'opening' | 'tx' | 'sending' | 'error';
let phase: Phase = 'idle';
let phaseErr = '';
const listeners = new Set<() => void>();
const setPhase = (p: Phase, err = '') => {
  phase = p;
  phaseErr = err;
  listeners.forEach((f) => f());
};
function usePhase() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return { phase, err: phaseErr };
}

const voiceChannels = (chs: ReturnType<typeof getState>['channels']) => chs.filter((c): c is NtfyChannel => c.kind === 'ntfy' && c.enabled && !!c.posKey);
function currentChannel(): NtfyChannel | undefined {
  const s = getState();
  const list = voiceChannels(s.channels);
  return list.find((c) => c.id === s.voiceChannelId) ?? list[0];
}

let held = false;
async function pttDown() {
  if (held) return;
  held = true;
  if (!currentChannel()) return setPhase('error', 'Set up a team channel first.');
  setPhase('opening');
  try {
    await rec.start();
    if (!held) return void pttUp();
    setPhase('tx');
  } catch (e) {
    held = false;
    setPhase('error', /denied|NotAllowed/i.test(String(e)) ? 'Microphone blocked. Allow it for Vigilance.' : String(e instanceof Error ? e.message : e));
  }
}
async function pttUp() {
  held = false;
  const clip = rec.stop();
  if (!clip) return setPhase(phase === 'error' ? 'error' : 'idle');
  const ch = currentChannel();
  if (!ch) return setPhase('idle');
  setPhase('sending');
  try {
    await transmit(ch.id, clip.audio, clip.ms, clip.t);
    setPhase('idle');
  } catch (e) {
    setPhase('error', `Not sent: ${String(e instanceof Error ? e.message : e)}`);
  }
}
rec.onLimit = () => void pttUp();

/** Hold V anywhere (outside text fields) to talk. */
export function usePttHotkey() {
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (!voiceChannels(getState().channels).length) return;
      e.preventDefault();
      void pttDown();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && held) void pttUp();
    };
    const blur = () => held && void pttUp();
    // Browsers keep audio muted until the user interacts; unlock on the first click or key.
    const unlock = () => voiceChannels(getState().channels).length && audioCtx();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
}

/** Hold-to-talk button. `compact` is the top-bar version. */
export function PttButton({ compact = false }: { compact?: boolean }) {
  const { phase: p, err } = usePhase();
  const rx = useStore((s) => s.voiceRx);
  const all = useStore((s) => s.channels);
  const chans = useMemo(() => voiceChannels(all), [all]);
  const [, tick] = useState(0);
  const t0 = useRef(0);
  useEffect(() => {
    if (p !== 'tx') return;
    t0.current = Date.now();
    const i = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [p]);
  useEffect(() => {
    if (!rx) return;
    const i = setTimeout(() => tick((n) => n + 1), Math.max(0, rx.until - Date.now()) + 50);
    return () => clearTimeout(i);
  }, [rx]);
  if (!chans.length) return null;
  const hearing = rx && rx.until > Date.now() ? rx.by : null;
  const secs = p === 'tx' ? Math.floor((Date.now() - t0.current) / 1000) : 0;
  const label = p === 'tx' ? `TX ${secs}s` : p === 'opening' ? 'MIC…' : p === 'sending' ? 'SENDING' : hearing ? `RX ${hearing}` : compact ? 'PTT' : 'Hold to talk';
  const state = p === 'tx' || p === 'opening' ? 'tx' : hearing ? 'rx' : p === 'sending' ? 'busy' : p === 'error' ? 'err' : '';
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      void pttDown();
    },
    onPointerUp: () => void pttUp(),
    onPointerCancel: () => void pttUp(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  return (
    <button
      className={`ptt ${compact ? 'compact mono' : 'big'} ${state}`}
      {...handlers}
      title={p === 'error' ? err : `Push to talk on ${currentChannel()?.name ?? 'the team channel'}: hold this button or hold V. Up to ${MAX_CLIP_S} s; everyone on the channel hears it.`}
      aria-label="Push to talk"
    >
      <Icon name="mic" size={compact ? 13 : 18} />
      <span>{label}</span>
      {state === 'tx' && <i className="ptt-dot" />}
    </button>
  );
}

/** Radio panel for the Team view: channel, big PTT button, recent transmissions. */
export function RadioPanel() {
  const all = useStore((s) => s.channels);
  const chans = useMemo(() => voiceChannels(all), [all]);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const clips = useStore((s) => s.voice);
  const { phase: p, err } = usePhase();
  const [playing, setPlaying] = useState('');
  const [replayErr, setReplayErr] = useState('');
  if (!chans.length) return null;
  const cur = chans.find((c) => c.id === voiceChannelId) ?? chans[0];
  const shown = clips.filter((c) => c.channelId === cur.id).slice(0, 8);
  return (
    <div className="radio-panel">
      <div className="tv-chat-head mono">
        PUSH TO TALK · {cur.name.toUpperCase()}
        {chans.length > 1 && (
          <select value={cur.id} onChange={(e) => setState({ voiceChannelId: e.target.value })} aria-label="Voice channel">
            {chans.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <PttButton />
      <p className="muted small-text">{p === 'error' ? <span className="crit">{err}</span> : 'Hold the button or the V key, talk, release to send. Encrypted; heard by everyone on the channel.'}</p>
      {replayErr && <p className="crit small-text">{replayErr}</p>}
      {shown.map((c) => (
        <button
          key={c.id}
          className={`clip-row ${playing === c.id ? 'on' : ''}`}
          onClick={() => {
            setPlaying(c.id);
            setReplayErr('');
            replayClip(c)
              .catch((e) => setReplayErr(String(e instanceof Error ? e.message : e)))
              .finally(() => setPlaying(''));
          }}
          title="Play again"
        >
          <Icon name="play" size={12} />
          <b>{c.mine ? 'You' : c.by}</b>
          <span className="mono muted">
            {(c.ms / 1000).toFixed(1)} s · {ageText(Date.now() - c.at)} ago
          </span>
        </button>
      ))}
    </div>
  );
}
