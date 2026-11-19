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

function playNext(g: number) {
  if (g !== gen || !audio || tuned?.status === 'loading') return;
  const c = queue.shift();
  if (!c) return patch({ status: 'waiting', now: undefined, emergency: false });
  patch({ status: 'playing', now: groups[c.talkgroup] ?? `Talkgroup ${c.talkgroup}`, emergency: c.emergency });
  audio.src = c.url;
  void audio.play().catch(() => playNext(g));
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

/** Start listening to an OpenMHz system (the last few calls first, then new ones as they arrive). */
export async function tune(system: string, name: string) {
  if (tuned?.system === system && tuned.status !== 'error') return;
  stop();
  const g = ++gen;
  tuned = { system, name, status: 'loading' };
  emit();
  audio = new Audio();
  audio.volume = volume;
  audio.addEventListener('ended', () => playNext(g));
  audio.addEventListener('error', () => playNext(g));
  // Browsers only allow sound after a tap: start the element now, inside the click.
  audio.src = SILENCE;
  void audio.play().catch(() => {});
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: name, artist: 'Live scanner' });
    navigator.mediaSession.setActionHandler('pause', stop);
    navigator.mediaSession.setActionHandler('stop', stop);
  }
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
  window.clearTimeout(timer);
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio = null;
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

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const useTuned = () => useSyncExternalStore(subscribe, () => tuned);
export const useVolume = () => useSyncExternalStore(subscribe, () => volume);
