import { crosses, cooledDown, dueForEscalation, matchAircraft, matchSignal, METRIC_LABEL, type Metric, type Monitor, type MonitorHit } from '../../lib/monitors';
import { ntfyPriority } from '../../lib/rules';
import { ntfySend } from '../../lib/http';
import type { LonLat } from '../../lib/geo';
import type { Severity, Signal } from '../../lib/signals';
import { setShared } from '../bus';
import { alertTone } from '../sound';
import { getState, type State } from '../store';
import { log, onSignal } from './core';
import { desktopNotify, notifyGeneral, quietNow, sendWebhook } from './notify';

const HITS_MAX = 300;
const lastFired = new Map<string, number>();
/** Threshold monitors fire when the line is crossed, then re-arm once it's back. */
const armed = new Map<string, boolean>();

const uid = () => Math.random().toString(36).slice(2, 10);

export function metricValue(s: State, metric: Metric): number | null {
  switch (metric) {
    case 'stability':
      return s.stability?.score ?? null;
    case 'aqi':
      return s.air?.aqi ?? null;
    case 'outageCustomers':
      return s.outages.reduce((n, o) => n + o.customers, 0);
    case 'violent48h':
      return s.stability?.violent48h ?? null;
    case 'helos':
      return s.aircraft.filter((a) => a.kind === 'heli').length;
    case 'orbits':
      return Object.keys(s.orbiting).length;
    case 'feedsDown':
      return Object.values(s.feeds).filter((f) => f.status === 'error').length;
    case 'nwsAlerts':
      return s.alerts.length;
  }
}

async function deliver(m: Monitor, hit: MonitorHit, again = false) {
  const prefix = again ? `STILL UNACKNOWLEDGED · ` : '';
  const title = `${prefix}${m.name}: ${hit.title}`;
  const quiet = quietNow(hit.severity) && !m.breakQuiet;
  if (m.actions.sound && !quiet) alertTone(hit.severity);
  if (m.actions.desktop) void desktopNotify(title, hit.detail);
  if (quiet) return;
  const p = getState().settings.push;
  if (m.actions.phone && p.topic) {
    try {
      await ntfySend({ server: p.server, topic: p.topic, title, message: hit.detail, priority: ntfyPriority(hit.severity), tags: 'rotating_light', click: hit.url });
    } catch (e) {
      log(`PUSH   Monitor push failed: ${String(e)}`, 2);
    }
  }
  if (m.actions.webhook) void sendWebhook(title, hit.detail, hit.severity, hit.url);
}

function fire(m: Monitor, key: string, h: { title: string; detail: string; severity: Severity; location: LonLat | null; url?: string; hex?: string }) {
  const now = Date.now();
  const k = `${m.id}:${key}`;
  if (!cooledDown(lastFired.get(k), now, m.cooldownMin)) return;
  lastFired.set(k, now);
  const hit: MonitorHit = { id: uid(), monitorId: m.id, monitorName: m.name, at: now, acked: false, escalations: 0, ...h };
  setShared({ hits: [hit, ...getState().hits].slice(0, HITS_MAX) });
  log(`WATCH  ${m.name}: ${h.title}`, h.severity);
  void deliver(m, hit);
}

function onNewSignal(sig: Signal, message: string) {
  notifyGeneral({ title: sig.title, message, severity: sig.severity, location: sig.location, url: sig.url });
  for (const m of getState().monitors) {
    const why = matchSignal(m, sig);
    if (why) fire(m, sig.id, { title: sig.title, detail: `${message} — ${why}`, severity: Math.max(m.severity, sig.severity) as Severity, location: sig.location, url: sig.url });
  }
}

/** Aircraft watchlists, thresholds and escalation; runs every 20 s on the leader. */
export function checkMonitors() {
  const s = getState();
  const now = Date.now();
  for (const m of s.monitors) {
    if (!m.enabled) continue;
    if (m.kind === 'aircraft') {
      for (const a of s.aircraft) {
        const why = matchAircraft(m, a);
        if (why)
          fire(m, a.hex, {
            title: `${a.callsign || a.reg || a.hex.toUpperCase()}${a.type ? ` (${a.type})` : ''} overhead`,
            detail: `${a.altFt != null ? `${a.altFt.toLocaleString('en-US')} ft` : 'altitude unknown'} · ${a.distNm.toFixed(1)} nm from center · watchlist "${why}"`,
            severity: m.severity,
            location: [a.lon, a.lat],
            hex: a.hex,
            url: `https://globe.adsb.lol/?icao=${a.hex}`,
          });
      }
    } else if (m.kind === 'threshold') {
      const v = metricValue(s, m.metric);
      const over = crosses(m, v);
      const wasArmed = armed.get(m.id) ?? true;
      if (over && wasArmed) {
        armed.set(m.id, false);
        fire(m, `t${Math.floor(now / 1000)}`, { title: `${METRIC_LABEL[m.metric]} is ${v} (${m.op} ${m.value})`, detail: `${METRIC_LABEL[m.metric]} crossed your line of ${m.op} ${m.value}. Now ${v}.`, severity: m.severity, location: null });
      } else if (!over && v != null) armed.set(m.id, true);
    }
  }
  const due = dueForEscalation(s.hits, s.monitors, now);
  if (due.length) {
    const ids = new Set(due.map((h) => h.id));
    setShared({ hits: s.hits.map((h) => (ids.has(h.id) ? { ...h, escalations: h.escalations + 1 } : h)) });
    for (const h of due) {
      const m = s.monitors.find((x) => x.id === h.monitorId);
      if (m) void deliver(m, h, true);
    }
  }
}

export function startMonitors() {
  onSignal(onNewSignal);
  window.setInterval(checkMonitors, 20_000);
}

/** When the city changes, thresholds start fresh. */
export function resetMonitors() {
  armed.clear();
}
