import { emit, listen } from '@tauri-apps/api/event';
import { isTauri } from '../lib/http';
import { getState, setState, type DataState, type SharedUi } from './store';

/**
 * Cross-window sync. The main console window is the leader: it polls the data
 * sources and broadcasts snapshots. Any window can change shared UI (selection,
 * city, filters), and every window applies it.
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

export function startBus(isLeader: boolean) {
  if (isTauri()) void listen<Msg>(TOPIC, (e) => receive(e.payload));
  else {
    channel = new BroadcastChannel(TOPIC);
    channel.onmessage = (e) => receive(e.data as Msg);
  }
  if (isLeader) {
    onHello = () => {
      publishData();
      const { packId, selectedHex, ceilingAglFt, hideGround, layers, muted } = getState();
      send({ type: 'ui', from: windowId, ui: { packId, selectedHex, ceilingAglFt, hideGround, layers, muted } });
    };
  } else {
    send({ type: 'hello', from: windowId });
  }
}

export function publishData() {
  const { aircraft, trails, orbiting, alerts, incidents, log, feeds } = getState();
  send({ type: 'data', from: windowId, data: { aircraft, trails, orbiting, alerts, incidents, log, feeds } });
}

/** Change shared UI in this window and every other window. */
export function setShared(ui: Partial<SharedUi>) {
  setState(ui);
  send({ type: 'ui', from: windowId, ui });
}
