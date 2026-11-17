import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { areasContaining } from '../../lib/areas';
import { destination, type LonLat } from '../../lib/geo';
import { isTauri } from '../../lib/http';
import { decodeServiceData, encodeBasic, encodeLocation, encodePack, encodeSystem, hexToBytes, UA_TYPES, wrapServiceData } from '../../lib/odid';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState, subscribe, type DroneTrack } from '../store';
import { ctx, emitSignal, log, removeIncidents, upsertIncident } from './core';

const EXPIRE_MS = 90_000;
const tracks = new Map<string, DroneTrack>();
const deviceToId = new Map<string, string>();

function touch(device: string, data: Uint8Array, at: number, simulated: boolean) {
  const msgs = decodeServiceData(data);
  if (!msgs.length) return;
  const basic = msgs.find((m) => m.type === 'basic');
  if (basic?.type === 'basic' && basic.uasId) deviceToId.set(device, basic.uasId);
  const id = deviceToId.get(device) ?? device;
  const t: DroneTrack = tracks.get(id) ?? {
    id,
    uasId: '',
    uaType: 0,
    location: null,
    heightM: null,
    altGeoM: null,
    speedMs: null,
    directionDeg: null,
    operator: null,
    operatorId: '',
    selfId: '',
    firstSeen: at,
    lastSeen: at,
    trail: [],
    simulated,
  };
  for (const m of msgs) {
    if (m.type === 'basic') Object.assign(t, { uasId: m.uasId, uaType: m.uaType });
    else if (m.type === 'location' && m.lat != null && m.lon != null) {
      const loc: LonLat = [m.lon, m.lat];
      Object.assign(t, { location: loc, heightM: m.heightM, altGeoM: m.altGeoM, speedMs: m.speedMs, directionDeg: m.directionDeg });
      t.trail = [...t.trail, loc].slice(-120);
    } else if (m.type === 'system' && m.operatorLat != null && m.operatorLon != null) t.operator = [m.operatorLon, m.operatorLat];
    else if (m.type === 'operatorId') t.operatorId = m.operatorId;
    else if (m.type === 'selfId') t.selfId = m.text;
  }
  t.lastSeen = at;
  const isNew = !tracks.has(id);
  tracks.set(id, t);
  if (isNew && t.location) announce(t);
  else if (isNew) window.setTimeout(() => tracks.get(id)?.location && announce(tracks.get(id)!), 3000);
}

const announced = new Set<string>();
function announce(t: DroneTrack) {
  if (announced.has(t.id)) return;
  announced.add(t.id);
  const inAreas = areasContaining(t.location, getState().areas.filter((a) => a.packId === ctx.packId));
  const high = (t.heightM ?? 0) > 122; // above the 400 ft limit for recreational flying
  const sev = high || inAreas.length ? 2 : 1;
  const name = t.uasId || 'Unidentified drone';
  const detail = `${UA_TYPES[t.uaType] ?? 'Drone'} ${name}${t.heightM != null ? ` at ${Math.round(t.heightM * 3.281)} ft` : ''}${t.simulated ? ' (SIMULATED)' : ''}`;
  log(`DRONE  ${detail}${inAreas.length ? ` over ${inAreas.map((a) => a.name).join(', ')}` : ''}`, sev);
  emitSignal({ id: `drone:${t.id}:${t.firstSeen}`, source: 'drone', kind: 'drone', title: t.simulated ? 'Drone detected (simulated)' : 'Drone detected', detail, severity: sev as 1 | 2, at: t.firstSeen, location: t.location, packId: ctx.packId }, { quiet: t.simulated });
}

function publishTracks() {
  const now = Date.now();
  for (const [id, t] of tracks) if (now - t.lastSeen > EXPIRE_MS) tracks.delete(id);
  const drones = [...tracks.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  for (const d of drones) {
    if (!d.location) continue;
    upsertIncident({ id: `drone:${d.id}`, kind: 'drone', severity: (d.heightM ?? 0) > 122 ? 2 : 1, title: d.simulated ? 'Drone nearby (simulated)' : 'Drone nearby', detail: `${d.uasId || d.id}${d.heightM != null ? ` · ${Math.round(d.heightM * 3.281)} ft` : ''}`, at: d.lastSeen, location: d.location }, false);
  }
  const live = new Set(drones.map((d) => `drone:${d.id}`));
  removeIncidents((i) => i.kind === 'drone' && !live.has(i.id));
  setState({ drones });
  publishData();
}

/** A fake drone circling near the first watch area (or the city center), sent through the real decoder. */
export function simulateDrone(seconds = 180) {
  const area = getState().areas.find((a) => a.packId === ctx.packId);
  const base: LonLat = area ? (area.polygon.reduce((s, p) => [s[0] + p[0] / area.polygon.length, s[1] + p[1] / area.polygon.length], [0, 0]) as LonLat) : destination(getPack(ctx.packId).center, 1800, 35);
  const operator = destination(base, 260, 200);
  const device = `SIM-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
  const uasId = `SIM1581F${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  let i = 0;
  log(`DRONE  Simulated drone launched near ${area ? area.name : 'the city center'} for ${seconds}s`, 0);
  const t = window.setInterval(() => {
    if (i++ > seconds) return window.clearInterval(t);
    const ang = (i * 6) % 360;
    const at = destination(base, 150, ang);
    const frame = encodePack([
      encodeBasic(uasId),
      encodeLocation({ lat: at[1], lon: at[0], altGeoM: 1700, heightM: 60 + 20 * Math.sin(i / 20), speedMs: 8, directionDeg: (ang + 90) % 360 }),
      encodeSystem(operator[1], operator[0]),
    ]);
    touch(device, wrapServiceData(frame, i), Date.now(), true);
    publishTracks();
  }, 1000);
}

let scanning = false;

async function setScanning(on: boolean) {
  if (!isTauri() || on === scanning) return;
  scanning = on;
  try {
    await invoke(on ? 'drones_start' : 'drones_stop');
    if (!on) setFeed('drones', { status: 'off', at: 0 });
  } catch (e) {
    setFeed('drones', { status: 'error', at: 0, error: String(e) });
  }
}

export function startDrones() {
  if (isTauri()) {
    void listen<{ device: string; data: string; at: number }>('drones:raw', (e) => {
      touch(e.payload.device, hexToBytes(e.payload.data), e.payload.at, false);
      setFeed('drones', { status: 'live', at: Date.now() });
    });
    void listen<string>('drones:status', (e) => {
      const s = e.payload;
      if (s === 'scanning') setFeed('drones', { status: 'live', at: Date.now() });
      else if (s.startsWith('error')) {
        scanning = false;
        setFeed('drones', { status: 'error', at: 0, error: s.replace(/^error: /, '') });
        log(`DRONE  Bluetooth ${s}`, 1);
      }
      publishData();
    });
  } else {
    setFeed('drones', { status: 'off', at: 0, error: 'Bluetooth scanning needs the desktop app' });
  }
  void setScanning(getState().settings.drones.scan);
  subscribe(() => void setScanning(getState().settings.drones.scan));
  window.setInterval(publishTracks, 5000);
}

export function resetDrones() {
  tracks.clear();
  deviceToId.clear();
}
