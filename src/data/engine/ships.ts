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
const EXPIRE_MS = 30 * 60_000;

/** Ships via AISstream.io: optional free key (no keyless live AIS exists for US waters). */
export function startShips(gen: number) {
  ships.clear();
  setState({ ships: [] });
  const key = getState().settings.keys.ais;
  if (!isTauri()) return setFeed('ships', { status: 'off', at: 0, error: 'Ships need the desktop app' });
  if (!key) {
    void invoke('ais_stop');
    return setFeed('ships', { status: 'off', at: 0, error: 'Optional: add a free AISstream.io key in Settings (coastal areas)' });
  }
  if (!listening) {
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
  void invoke('ais_start', { key, bbox: [p.center[0] - dl, p.center[1] - d, p.center[0] + dl, p.center[1] + d] }).catch((e) => setFeed('ships', { status: 'error', at: 0, error: String(e) }));
  const t = window.setInterval(() => {
    if (!alive(gen)) return window.clearInterval(t);
    const now = Date.now();
    for (const [k, s] of ships) if (now - s.at > EXPIRE_MS) ships.delete(k);
    setState({ ships: [...ships.values()] });
    publishData();
  }, 5000);
}
