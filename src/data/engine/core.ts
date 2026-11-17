import type { LonLat } from '../../lib/geo';
import { correlate, type Cluster } from '../../lib/correlate';
import { ntfyPriority, shouldPush } from '../../lib/rules';
import { getPack, placesOf } from '../../lib/packs';
import { describeLocation } from '../../lib/places';
import { storeRead, storeWrite, ntfySend } from '../../lib/http';
import type { Signal, Severity } from '../../lib/signals';
import { publishData } from '../bus';
import { alertTone } from '../sound';
import { getState, setState, type Incident, type LogEntry } from '../store';

/** The active city and a generation counter; pollers stop when the city changes. */
export const ctx = { packId: '', gen: 0 };
export const alive = (gen: number) => gen === ctx.gen;

const timers: number[] = [];
export function every(fn: () => void | Promise<void>, ms: number, runNow = true) {
  if (runNow) void fn();
  timers.push(window.setInterval(() => void fn(), ms));
}
export function clearTimers() {
  timers.splice(0).forEach((t) => window.clearInterval(t));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const LOG_MAX = 300;

export function log(text: string, severity: Severity = 0) {
  const entry: LogEntry = { id: uid(), at: Date.now(), severity, text };
  setState({ log: [entry, ...getState().log].slice(0, LOG_MAX) });
  publishData();
}

// ---------- Live incidents (current state, shown in the Alerts tab) ----------

export function upsertIncident(inc: Incident, announce: boolean) {
  const existing = getState().incidents;
  const isNew = !existing.some((i) => i.id === inc.id);
  const incidents = [inc, ...existing.filter((i) => i.id !== inc.id)].sort((a, b) => b.severity - a.severity || b.at - a.at);
  setState({ incidents });
  if (isNew && announce) alertTone(inc.severity);
}

export function removeIncidents(pred: (i: Incident) => boolean) {
  const incidents = getState().incidents.filter((i) => !pred(i));
  if (incidents.length !== getState().incidents.length) setState({ incidents });
}

// ---------- Signal history (persisted), correlation and phone push ----------

const HISTORY_MS = 72 * 3600_000;
const HISTORY_MAX = 6000;
let history: Signal[] = [];
const seen = new Set<string>();
const pushed = new Set<string>();
let saveTimer: number | undefined;

export const getHistory = () => history;

export async function loadHistory() {
  const saved = (await storeRead<Signal[]>('history')) ?? [];
  const cutoff = Date.now() - HISTORY_MS;
  history = saved.filter((s) => s.at >= cutoff);
  history.forEach((s) => seen.add(s.id));
}

function saveHistorySoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const cutoff = Date.now() - HISTORY_MS;
    history = history.filter((s) => s.at >= cutoff).slice(-HISTORY_MAX);
    void storeWrite('history', history);
  }, 15_000);
}

async function push(id: string, title: string, message: string, severity: Severity, location: LonLat | null, regional: boolean, tags: string) {
  const s = getState();
  if (pushed.has(id)) return;
  const pack = getPack(ctx.packId);
  const decision = shouldPush({ severity, location, regional }, s.settings.push, s.areas.filter((a) => a.packId === ctx.packId), Date.now(), pack.timezone);
  if (!decision.push) return;
  pushed.add(id);
  const areaNote = decision.areaNames.length ? ` [${decision.areaNames.join(', ')}]` : '';
  try {
    await ntfySend({
      server: s.settings.push.server,
      topic: s.settings.push.topic,
      title: `${title}${areaNote}`,
      message,
      priority: ntfyPriority(Math.min(4, severity + (decision.areaNames.length ? 1 : 0)) as Severity),
      tags,
    });
    log(`PUSH   Sent to phone: ${title}`, 0);
  } catch (e) {
    pushed.delete(id);
    log(`PUSH   Failed: ${String(e)}`, 2);
  }
}

const TAGS: Record<Signal['source'], string> = {
  adsb: 'helicopter',
  nws: 'cloud_with_lightning',
  traffic: 'car',
  news: 'newspaper',
  tfr: 'no_entry_sign',
  drone: 'flying_saucer',
  transit: 'bus',
  power: 'electric_plug',
  fire: 'fire',
  crime: 'police_car',
  quake: 'warning',
  flood: 'ocean',
  storm: 'thunder_cloud_and_rain',
  air: 'mask',
  hotspot: 'fire',
};

/**
 * Record a signal. Quiet signals (first load of a feed) go into history
 * without notifications, so starting the app doesn't flood your phone.
 */
export function emitSignal(sig: Signal, opts: { quiet?: boolean; regional?: boolean } = {}) {
  if (seen.has(sig.id)) return;
  seen.add(sig.id);
  history.push(sig);
  saveHistorySoon();
  if (!opts.quiet) {
    const where = describeLocation(sig.location, placesOf(getPack(sig.packId)));
    const message = `${sig.detail}${where ? ` (${where})` : ''}`;
    void push(sig.id, sig.title, message, sig.severity, sig.location, !!opts.regional, TAGS[sig.source]);
    for (const h of signalHooks) h(sig, message);
  }
  recomputeClusters(!opts.quiet);
}

/** Listeners for new (non-quiet) signals: general notifications and monitors. */
const signalHooks: ((sig: Signal, message: string) => void)[] = [];
export const onSignal = (fn: (sig: Signal, message: string) => void) => signalHooks.push(fn);

let knownClusters = new Map<string, number>();

export function recomputeClusters(announce = true) {
  const now = Date.now();
  const clusters: Cluster[] = correlate(history.filter((h) => h.packId === ctx.packId), now);
  for (const c of clusters) {
    const prevSources = knownClusters.get(c.id);
    if (announce && (prevSources == null || c.sources.length > prevSources)) {
      const where = describeLocation(c.center, placesOf(getPack(ctx.packId)));
      log(`INCIDENT ${c.title}${where ? ` ${where}` : ''}: ${c.sources.length} sources (${c.sources.join(', ')})`, c.severity);
      alertTone(c.severity);
      void push(
        `${c.id}:${c.sources.length}`,
        `Developing: ${c.title}`,
        `${c.sources.length} sources agree${where ? ` ${where}` : ''}: ${c.signals.map((s) => s.title).slice(0, 4).join(' · ')}`,
        c.severity,
        c.center,
        false,
        'rotating_light',
      );
    }
  }
  knownClusters = new Map(clusters.map((c) => [c.id, c.sources.length]));
  setState({ clusters });
  publishData();
}

export function resetForPack() {
  knownClusters = new Map();
}

export async function sendTestPush() {
  const s = getState().settings.push;
  try {
    await ntfySend({ server: s.server, topic: s.topic, title: 'Vigilante test alert', message: 'Phone alerts are working.', priority: 3, tags: 'white_check_mark' });
    log('PUSH   Test notification sent', 0);
  } catch (e) {
    log(`PUSH   Test failed: ${String(e)}`, 2);
  }
}

export async function pushText(id: string, title: string, message: string, tags: string) {
  const s = getState().settings.push;
  if (!s.enabled || !s.topic) return;
  try {
    await ntfySend({ server: s.server, topic: s.topic, title, message, priority: 3, tags });
  } catch (e) {
    log(`PUSH   Failed (${id}): ${String(e)}`, 2);
  }
}
