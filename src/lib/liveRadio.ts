/**
 * In-app live scanner: plays an OpenMHz system's radio calls back to back as they come in
 * (like the Android app). One system at a time. Broadcastify feeds keep opening their own
 * player, since their terms don't allow playing their streams elsewhere.
 */
import { useSyncExternalStore } from 'react';
import { getJson } from './http';
import { callsUrl, newerUrl, parseCalls, parseTalkgroups, talkgroupsUrl, type OmhzCall } from './openmhz';

export interface Tuned {
  system: string;
  name: string;
  status: 'loading' | 'playing' | 'waiting' | 'error';
  /** Talkgroup of the call playing now. */
  now?: string;
  emergency?: boolean;
  error?: string;
}

const POLL_MS = 12_000;
/** 0.1 s of silence: played inside the tap so the browser allows the calls that follow. */
const SILENCE = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
let tuned: Tuned | null = null;
let volume = 1;
let audio: HTMLAudioElement | null = null;
let queue: OmhzCall[] = [];
let lastAt = 0;
let seen = new Set<string>();
let groups: Record<number, string> = {};
let timer = 0;
let gen = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const patch = (p: Partial<Tuned>) => {
  if (tuned) {
    tuned = { ...tuned, ...p };
    emit();
  }
};

function enqueue(calls: OmhzCall[]) {
  for (const c of calls) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    queue.push(c);
    lastAt = Math.max(lastAt, c.at);
  }
}

let current = '';
/** Move to the next call. `from` is the call that just finished or failed, so a call that both errors and rejects advances once. */
function playNext(g: number, from = current) {
  if (g !== gen || !audio || tuned?.status === 'loading' || from !== current) return;
  const c = queue.shift();
  current = c?.id ?? '';
  if (!c) return patch({ status: 'waiting', now: undefined, emergency: false });
  patch({ status: 'playing', now: groups[c.talkgroup] ?? `Talkgroup ${c.talkgroup}`, emergency: c.emergency });
  try {
    audio.src = c.url;
    void audio.play().catch(() => window.setTimeout(() => playNext(g, c.id), 250));
  } catch {
    window.setTimeout(() => playNext(g, c.id), 250);
  }
}

/** Can this browser/webview decode OpenMHz audio (AAC in MP4)? Some Linux setups lack the codec. */
export function canPlayScanner(): boolean {
  try {
    const a = document.createElement('audio');
    return !!(a.canPlayType('audio/mp4; codecs="mp4a.40.2"') || a.canPlayType('audio/aac') || a.canPlayType('audio/x-m4a'));
  } catch {
    return false;
  }
}

function setMediaSession(name: string) {
  try {
    if (!('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'function') navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: 'Live scanner' });
    for (const action of ['pause', 'stop'] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, stop);
      } catch {
        /* action not supported here */
      }
    }
  } catch {
    /* media controls are optional */
  }
}

async function poll(g: number) {
  if (g !== gen || !tuned) return;
  try {
    enqueue(parseCalls(await getJson(newerUrl(tuned.system, lastAt))));
    if (g === gen && audio && (audio.paused || audio.ended) && tuned.status !== 'playing') playNext(g);
  } catch {
    /* keep polling; a dropped request just delays the next calls */
  }
  if (g === gen) timer = window.setTimeout(() => void poll(g), POLL_MS);
}

let lastTap = 0;
/** Start listening to an OpenMHz system (the last few calls first, then new ones as they arrive). Never throws. */
export async function tune(system: string, name: string): Promise<void> {
  try {
    await tuneUnsafe(system, name);
  } catch (e) {
    console.warn('radio', e);
    if (tuned?.system === system) patch({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

async function tuneUnsafe(system: string, name: string) {
  if (tuned?.system === system && tuned.status !== 'error') return;
  // Rapid repeated taps would start and tear down players faster than some webviews handle.
  if (Date.now() - lastTap < 350) return;
  lastTap = Date.now();
  stop();
  const g = ++gen;
  tuned = { system, name, status: 'loading' };
  emit();
  if (!canPlayScanner()) {
    patch({ status: 'error', error: 'this device can’t play scanner audio (AAC). On Linux, install the GStreamer “libav” / “bad” plugins' });
    return;
  }
  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume;
  const a = audio;
  // The tap-unlock silence ending or failing must not skip a call.
  const isCall = () => a === audio && !a.src.startsWith('data:');
  a.addEventListener('ended', () => isCall() && playNext(g));
  a.addEventListener('error', () => {
    if (!isCall()) return;
    const id = current;
    window.setTimeout(() => playNext(g, id), 250);
  });
  // Browsers only allow sound after a tap: start the element now, inside the click.
  try {
    a.src = SILENCE;
    void a.play().catch(() => {});
  } catch {
    /* fine: the first call will try again */
  }
  setMediaSession(name);
  try {
    const [calls, tg] = await Promise.all([getJson(callsUrl(system)), getJson(talkgroupsUrl(system)).catch(() => null)]);
    if (g !== gen) return;
    groups = tg ? parseTalkgroups(tg) : {};
    patch({ status: 'waiting' });
    const recent = parseCalls(calls).slice(-6);
    enqueue(recent);
    if (!lastAt) lastAt = Date.now();
    playNext(g);
    timer = window.setTimeout(() => void poll(g), POLL_MS);
  } catch (e) {
    if (g === gen) patch({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

export function stop() {
  gen++;
  current = '';
  window.clearTimeout(timer);
  const a = audio;
  audio = null;
  if (a) {
    try {
      a.pause();
      a.removeAttribute('src');
    } catch {
      /* already gone */
    }
  }
  queue = [];
  seen = new Set();
  lastAt = 0;
  if (tuned) {
    tuned = null;
    emit();
  }
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = volume;
  emit();
}

/** What this device is tuned to, outside React (for team reports). */
export const getTuned = () => tuned;

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const useTuned = () => useSyncExternalStore(subscribe, () => tuned);
export const useVolume = () => useSyncExternalStore(subscribe, () => volume);
