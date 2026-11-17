import { emit, listen } from '@tauri-apps/api/event';
import { isTauri } from '../lib/http';
import { getState, setState, type DataState, type SharedUi } from './store';

/**
 * Cross-window sync. The main console window is the leader: it polls the data
 * sources and broadcasts snapshots. Any window can change shared UI (selection,
 * city, filters, settings, watch areas), and every window applies it.
 *   Desktop: Tauri events (all webview windows).
 *   Browser: BroadcastChannel (all tabs/popups of the same origin).
 */
type Msg =
  | { type: 'data'; from: string; data: DataState }
  | { type: 'ui'; from: string; ui: Partial<SharedUi> }
  | { type: 'hello'; from: string };

const TOPIC = 'vigilante:bus';
const windowId = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
let onHello: (() => void) | null = null;
let publishQueued = false;

function send(msg: Msg) {
  if (isTauri()) void emit(TOPIC, msg);
  else channel?.postMessage(msg);
}

function receive(msg: Msg) {
  if (msg.from === windowId) return;
  if (msg.type === 'data') setState(msg.data);
  else if (msg.type === 'ui') setState(msg.ui);
  else if (msg.type === 'hello') onHello?.();
}

export function sharedSnapshot(): SharedUi {
  const { packId, selectedHex, focus, ceilingAglFt, hideGround, layers, muted, settings, areas, locations, requests, monitors, hits, channels, chat, team, meshStatus, waypoints } = getState();
  return { packId, selectedHex, focus, ceilingAglFt, hideGround, layers, muted, settings, areas, locations, requests, monitors, hits, channels, chat, team, meshStatus, waypoints };
}

export function startBus(isLeader: boolean) {
  if (isTauri()) void listen<Msg>(TOPIC, (e) => receive(e.payload));
  else {
    channel = new BroadcastChannel(TOPIC);
    channel.onmessage = (e) => receive(e.data as Msg);
  }
  if (isLeader) {
    onHello = () => {
      publishData();
      send({ type: 'ui', from: windowId, ui: sharedSnapshot() });
    };
  } else {
    send({ type: 'hello', from: windowId });
  }
}

/** Broadcast the data snapshot (coalesced to one send per tick). */
export function publishData() {
  if (publishQueued) return;
  publishQueued = true;
  queueMicrotask(() => {
    publishQueued = false;
    const { aircraft, trails, orbiting, alerts, incidents, clusters, tfrs, traffic, cameras, transit, outages, fires, webcams, crimes, requests311, hotspots, quakes, wanted, gauges, air, airportDelays, storms, ships, stability, stabilityHistory, insights, ai, news, drones, brief, log, feeds } = getState();
    send({ type: 'data', from: windowId, data: { aircraft, trails, orbiting, alerts, incidents, clusters, tfrs, traffic, cameras, transit, outages, fires, webcams, crimes, requests311, hotspots, quakes, wanted, gauges, air, airportDelays, storms, ships, stability, stabilityHistory, insights, ai, news, drones, brief, log, feeds } });
  });
}

/** Change shared UI in this window and every other window. */
export function setShared(ui: Partial<SharedUi>) {
  setState(ui);
  send({ type: 'ui', from: windowId, ui });
}
