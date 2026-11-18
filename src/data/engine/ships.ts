import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { NM_TO_M } from '../../lib/geo';
import { isTauri } from '../../lib/http';
import { applyAis, type Ship } from '../../lib/intel';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx } from './core';

const ships = new Map<string, Ship>();
let listening = false;
let socket: WebSocket | null = null;

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';

/** Same subscription message as src-tauri/src/ais.rs. bbox = [west, south, east, north]. */
export function aisSubscription(key: string, bbox: [number, number, number, number]): string {
  const [west, south, east, north] = bbox;
  return JSON.stringify({ APIKey: key, BoundingBoxes: [[[south, west], [north, east]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'] });
}

/** Web build: the visitor's own AISstream key, from their browser straight to AISstream. */
function startBrowserAis(key: string, bbox: [number, number, number, number], gen: number) {
  socket?.close();
  const ws = new WebSocket(AIS_URL);
  socket = ws;
  ws.onopen = () => ws.send(aisSubscription(key, bbox));
  ws.onmessage = async (e) => {
    if (!alive(gen)) return ws.close();
    const raw = typeof e.data === 'string' ? e.data : e.data instanceof Blob ? await e.data.text() : '';
    if (applyAis(ships, raw)) setFeed('ships', { status: 'live', at: Date.now() });
  };
  ws.onerror = () => setFeed('ships', { status: 'error', at: 0, error: 'AISstream connection failed (check the key; AISstream may refuse browser connections, the desktop app always works)' });
  ws.onclose = () => {
    if (socket === ws) socket = null;
  };
}
const EXPIRE_MS = 30 * 60_000;

/** Ships via AISstream.io: optional free key (no keyless live AIS exists for US waters). */
export function startShips(gen: number) {
  ships.clear();
  setState({ ships: [] });
  const key = getState().settings.keys.ais;
  if (!key) {
    if (isTauri()) void invoke('ais_stop');
    socket?.close();
    socket = null;
    return setFeed('ships', { status: 'off', at: 0, error: 'Optional: add a free AISstream.io key in Settings (coastal areas)' });
  }
  if (isTauri() && !listening) {
    listening = true;
    void listen<string>('ais:msg', (e) => {
      if (applyAis(ships, e.payload)) setFeed('ships', { status: 'live', at: Date.now() });
    });
    void listen<string>('ais:status', (e) => {
      if (e.payload.startsWith('error')) setFeed('ships', { status: 'error', at: 0, error: e.payload });
      publishData();
    });
  }
  const p = getPack(ctx.packId);
  const d = (p.radiusNm * NM_TO_M) / 111_000;
  const dl = d / Math.cos((p.center[1] * Math.PI) / 180);
  const bbox: [number, number, number, number] = [p.center[0] - dl, p.center[1] - d, p.center[0] + dl, p.center[1] + d];
  if (isTauri()) void invoke('ais_start', { key, bbox }).catch((e) => setFeed('ships', { status: 'error', at: 0, error: String(e) }));
  else startBrowserAis(key, bbox, gen);
  const t = window.setInterval(() => {
    if (!alive(gen)) return window.clearInterval(t); // a new start (or no key) closes the old socket
    const now = Date.now();
    for (const [k, s] of ships) if (now - s.at > EXPIRE_MS) ships.delete(k);
    setState({ ships: [...ships.values()] });
    publishData();
  }, 5000);
}
