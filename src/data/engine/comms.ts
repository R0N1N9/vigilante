import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { meshText, ntfyPublishBody, ntfyStreamUrl, ntfyToMessage, parseSpot, type ChatMessage, type MeshChannel, type NtfyChannel, type NtfyEvent, type TeamChannel, type TeamMember } from '../../lib/comms';
import { decodeFromRadio, decodePosition, decodeUser, encodeHeartbeat, encodeText, encodeWantConfig, nodeIdOf, PORT, type MeshUser } from '../../lib/meshproto';
import { isTauri } from '../../lib/http';
import { openPosition, posTopic } from '../../lib/poscrypt';
import { deviceOf, markFromWire, markToWire, MARK_CATEGORIES, openOps, opsTopic, reached, sealOps, toWire, type Mark, type OpsMessage, type Waypoint } from '../../lib/waypoints';
import { fieldCodeOf, FIELD_CODES } from '../../lib/comms';
import type { MonitorHit } from '../../lib/monitors';
import type { LonLat } from '../../lib/geo';
import type { Severity, Signal } from '../../lib/signals';
import { setShared } from '../bus';
import { alertTone } from '../sound';
import { getState, subscribe, type State } from '../store';
import { log, onSignal } from './core';
import { desktopNotify } from './notify';
import { connectVoice, dropVoice } from './voice';
import { connectPhotos, dropPhotos, ingestPhotoEvent } from './photos';

const CHAT_MAX = 600;
const TEAM_TTL_MS = 6 * 3600_000;

// ---------- Shared helpers ----------

function addMessages(msgs: ChatMessage[]) {
  if (!msgs.length) return;
  const s = getState();
  const known = new Set(s.chat.map((m) => m.id));
  const knownRemote = new Set(s.chat.map((m) => m.remoteId).filter(Boolean));
  const fresh = msgs.filter((m) => !known.has(m.id) && !(m.remoteId && knownRemote.has(m.remoteId)));
  if (!fresh.length) return;
  const chat = [...s.chat, ...fresh].sort((a, b) => a.at - b.at).slice(-CHAT_MAX);
  setShared({ chat });
  fresh.forEach(raiseFieldAlert);
  const incoming = fresh.filter((m) => !m.mine && Date.now() - m.at < 5 * 60_000);
  if (incoming.length) {
    alertTone(1);
    const last = incoming.at(-1)!;
    const ch = s.channels.find((c) => c.id === last.channelId);
    if (s.settings.notify.desktop && !document.hasFocus()) void desktopNotify(`${last.from} · ${ch?.name ?? 'Team'}`, last.text);
  }
}

function patchMessage(id: string, patch: Partial<ChatMessage>) {
  setShared({ chat: getState().chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

const TRAIL_MAX = 40;

function upsertMember(m: TeamMember) {
  const now = Date.now();
  const prev = getState().team.find((x) => x.id === m.id);
  if (prev && prev.at > m.at) return; // out-of-order (history replay)
  // No location (presence only) or a fresh start after going dark: no trail.
  const trail = m.source === 'ntfy' || !m.location ? undefined : [...(prev?.dark ? [] : (prev?.trail ?? [])), m.location].slice(-TRAIL_MAX);
  const team = [{ ...m, trail }, ...getState().team.filter((x) => x.id !== m.id && now - x.at < TEAM_TTL_MS)];
  setShared({ team });
  checkArrivals(m);
}

/** The console marks an agent arrived when their own position reaches an active waypoint meant for them. */
function checkArrivals(m: TeamMember) {
  const dev = deviceOf(m.id);
  if (!dev || !m.location) return;
  const wps = getState().waypoints;
  let changed = false;
  const next = wps.map((w) => {
    if (w.state !== 'active' || w.channelId !== m.channelId || (w.to.length && !w.to.includes(dev)) || w.acks[dev]?.state === 'arrived' || !reached(w, m.location)) return w;
    changed = true;
    log(`TEAM   ${m.name} arrived at waypoint "${w.name}"`, 0);
    return { ...w, acks: { ...w.acks, [dev]: { state: 'arrived' as const, at: Date.now(), name: m.name, auto: true } } };
  });
  if (changed) setShared({ waypoints: next });
}

function removeMember(id: string) {
  setShared({ team: getState().team.filter((x) => x.id !== id) });
}

/** SOS / backup calls from phones become alerts that sit in the inbox until acknowledged. */
/** Vigil sends "📍 SOS LOCATION — name" with a map link when the SOS went out before a GPS fix. */
const SOS_LOCATION = '📍 SOS LOCATION';

function raiseFieldAlert(m: ChatMessage) {
  if (m.text.startsWith(SOS_LOCATION) && m.spot && !m.mine) {
    // Attach the late location to that sender's open SOS alert instead of raising a new one.
    const s = getState();
    const hit = s.hits.find((h) => h.monitorId === 'team-field' && !h.acked && !h.location && h.title.endsWith(`: ${m.from}`));
    if (hit) setShared({ hits: s.hits.map((h) => (h.id === hit.id ? { ...h, location: [m.spot!.lon, m.spot!.lat], detail: `${h.detail} · location received` } : h)) });
    return;
  }
  const code = fieldCodeOf(m.text);
  if (!code || FIELD_CODES[code].severity < 3 || m.mine || Date.now() - m.at > 30 * 60_000) return;
  const s = getState();
  const ch = s.channels.find((c) => c.id === m.channelId);
  const hit: MonitorHit = {
    id: `field:${m.id}`,
    monitorId: 'team-field',
    monitorName: `TEAM · ${ch?.name ?? 'channel'}`,
    at: m.at,
    title: `${FIELD_CODES[code].text}: ${m.from}`,
    detail: m.text,
    severity: FIELD_CODES[code].severity,
    location: m.spot ? [m.spot.lon, m.spot.lat] : null,
    acked: false,
    escalations: 0,
  };
  if (s.hits.some((h) => h.id === hit.id)) return;
  setShared({ hits: [hit, ...s.hits].slice(0, 300) });
  alertTone(4);
  void desktopNotify(hit.title, `${ch?.name ?? 'Team'}${m.spot ? ' · location attached' : ''}`);
  log(`TEAM   ${hit.title}`, hit.severity);
}

// ---------- ntfy ----------

const streams = new Map<string, { es: EventSource; key: string }>();
const posStreams = new Map<string, { es: EventSource; key: string }>();

const opsStreams = new Map<string, { es: EventSource; key: string }>();

function applyOps(ch: NtfyChannel, m: OpsMessage) {
  const wps = getState().waypoints;
  if (m.type === 'wp') {
    const prev = wps.find((w) => w.id === m.id);
    if (prev && prev.at > m.t && prev.state === m.state) return;
    const w: Waypoint = { id: m.id, channelId: ch.id, name: m.name, note: m.note ?? '', location: [m.lon, m.lat], to: m.to, priority: m.pri, state: m.state, by: m.by, at: m.t, acks: prev?.acks ?? {} };
    setShared({ waypoints: [w, ...wps.filter((x) => x.id !== m.id)] });
  } else if (m.type === 'mark') {
    const marks = getState().marks;
    const prev = marks.find((x) => x.id === m.id);
    if (prev && prev.at >= m.t) return;
    const mk = markFromWire(m, ch.id);
    setShared({ marks: [mk, ...marks.filter((x) => x.id !== m.id)].slice(0, 500) });
    // A teammate's fresh ping deserves attention; our own (echoed back) doesn't.
    const mine = m.byId === getState().settings.team.installId;
    if (!prev && !mine && m.kind === 'ping' && Date.now() - m.t < 5 * 60_000) {
      alertTone(2);
      void desktopNotify(`Ping from ${m.by}`, m.desc || m.name);
      log(`TEAM   Ping from ${m.by}: ${m.desc || m.name}`, 1);
    } else if (!prev && !mine && m.kind === 'investigate' && Date.now() - m.t < 5 * 60_000) {
      void desktopNotify(`${m.by}: investigate`, m.desc || m.name);
      log(`TEAM   ${m.by} flagged a place to investigate: "${m.name}"`, 1);
    } else if (!prev && !mine && Date.now() - m.t < 5 * 60_000) log(`TEAM   ${m.by} marked ${MARK_CATEGORIES[m.cat] ?? ''} "${m.name}"`, 0);
    else if (prev && !mine && m.kind === 'investigate' && prev.state !== m.state) {
      if (m.state === 'progress') log(`TEAM   ${m.by} is checking "${m.name}"`, 0);
      if (m.state === 'done') log(`TEAM   ${m.by} resolved "${m.name}"${m.res ? `: ${m.res}` : ''}`, 0);
    }
  } else {
    const w = wps.find((x) => x.id === m.wp);
    if (!w || (w.acks[m.id] && w.acks[m.id].at >= m.t)) return;
    setShared({ waypoints: wps.map((x) => (x.id === m.wp ? { ...x, acks: { ...x.acks, [m.id]: { state: m.state, at: m.t, name: m.n } } } : x)) });
    if (m.state === 'declined') log(`TEAM   ${m.n} can't make it to "${w.name}"`, 1);
  }
}

function connectOps(ch: NtfyChannel) {
  const key = `${ch.server}|${ch.topic}|${ch.token}|${ch.posKey}`;
  const cur = opsStreams.get(ch.id);
  if (cur?.key === key) return;
  cur?.es.close();
  if (!ch.posKey) {
    opsStreams.delete(ch.id);
    return;
  }
  const es = new EventSource(ntfyStreamUrl({ ...ch, topic: opsTopic(ch.topic) }, '24h'));
  es.onmessage = (e) => onOpsEvent(ch, e.data);
  opsStreams.set(ch.id, { es, key });
}

function onOpsEvent(ch: NtfyChannel, data: string) {
  try {
    const ev = JSON.parse(data) as NtfyEvent;
    if (ev.event === 'message' && ev.message) void openOps(ch.posKey, ev.message).then((m) => m && applyOps(ch, m));
  } catch {
    /* keepalive */
  }
}

async function publishOps(ch: NtfyChannel, m: OpsMessage) {
  const res = await fetch(`${ch.server.replace(/\/$/, '')}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}) },
    body: JSON.stringify({ topic: opsTopic(ch.topic), message: await sealOps(ch.posKey, m), tags: ['vigilance-ops'] }),
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
}

/** Send (or update) a waypoint to agents, plus a short chat notice without the location. */
export async function sendWaypoint(w: Waypoint, notify = true) {
  const s = getState();
  const ch = s.channels.find((c): c is NtfyChannel => c.id === w.channelId && c.kind === 'ntfy');
  if (!ch?.posKey) throw new Error('This channel has no encryption key; create a new channel or re-join from a fresh invite.');
  setShared({ waypoints: [w, ...s.waypoints.filter((x) => x.id !== w.id)] });
  await publishOps(ch, toWire(w));
  if (notify) {
    const who = w.to.length ? s.team.filter((m) => w.to.includes(deviceOf(m.id) ?? '')).map((m) => m.name).join(', ') || `${w.to.length} agents` : 'everyone';
    const verb = w.state === 'active' ? (w.priority === 'urgent' ? 'URGENT waypoint' : 'Waypoint') : w.state === 'done' ? 'Waypoint completed' : 'Waypoint cancelled';
    postToChannel(ch.id, `📍 ${verb}: ${w.name} → ${who}. Open it in Vigil or the check-in page for directions.`);
  }
}

/** Place, edit or clear a mark (shared with everyone on the channel). */
export async function sendMark(m: Mark) {
  const s = getState();
  const ch = s.channels.find((c): c is NtfyChannel => c.id === m.channelId && c.kind === 'ntfy');
  if (!ch?.posKey) throw new Error('This channel has no encryption key; create a new channel or re-join from a fresh invite.');
  setShared({ marks: [m, ...s.marks.filter((x) => x.id !== m.id)] });
  await publishOps(ch, markToWire(m));
}

/** Live phone positions: a sibling topic carrying encrypted reports. */
function connectPositions(ch: NtfyChannel) {
  const key = `${ch.server}|${ch.topic}|${ch.token}|${ch.posKey}`;
  const cur = posStreams.get(ch.id);
  if (cur?.key === key) return;
  cur?.es.close();
  if (!ch.posKey) {
    posStreams.delete(ch.id);
    return;
  }
  const es = new EventSource(ntfyStreamUrl({ ...ch, topic: posTopic(ch.topic) }, '1h'));
  es.onmessage = (e) => onPosEvent(ch, e.data);
  posStreams.set(ch.id, { es, key });
}

function onPosEvent(ch: NtfyChannel, data: string) {
    let ev: NtfyEvent;
    try {
      ev = JSON.parse(data) as NtfyEvent;
    } catch {
      return;
    }
    if (ev.event !== 'message' || !ev.message) return;
    void openPosition(ch.posKey, ev.message).then((r) => {
      if (!r) return;
      const id = `phone:${ch.id}:${r.id}`;
      if (r.s === 'off') return removeMember(id);
      if (Date.now() - r.t > TEAM_TTL_MS) return;
      removeMember(`ntfy:${ch.id}:${r.n}`);
      if (r.s === 'dark') {
        // Stealth: forget where they were, keep only that they went dark.
        const team = getState().team.filter((x) => x.id !== id);
        setShared({ team: [{ id, name: r.n, channelId: ch.id, at: r.t, location: null, source: 'phone', app: r.app, dark: true }, ...team] });
        return;
      }
      const location: LonLat | null = r.lat != null && r.lon != null ? [r.lon, r.lat] : null;
      upsertMember({
        id,
        name: r.n,
        channelId: ch.id,
        at: r.t,
        location,
        source: 'phone',
        accuracyM: r.acc,
        speedMs: r.spd,
        heading: r.hdg,
        battery: r.bat,
        charging: r.chg,
        activity: r.act,
        heartRate: r.hr,
        env: r.env,
        app: r.app,
        perm: r.perm ?? ['loc'],
        profile: r.prof,
        radio: r.radio,
        device: r.dev,
      });
    });
  }

function connectNtfy(ch: NtfyChannel) {
  const key = `${ch.server}|${ch.topic}|${ch.token}`;
  const cur = streams.get(ch.id);
  if (cur?.key === key) return;
  cur?.es.close();
  const last = getState().chat.filter((m) => m.channelId === ch.id && m.remoteId).at(-1);
  const es = new EventSource(ntfyStreamUrl(ch, last?.remoteId ?? '24h'));
  es.onmessage = (e) => onChatEvent(ch, e.data);
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) log(`TEAM   ${ch.name}: connection closed (check the server and topic)`, 1);
  };
  streams.set(ch.id, { es, key });
}

function onChatEvent(ch: NtfyChannel, data: string) {
  const installId = getState().settings.team.installId;
  {
    try {
      const msg = ntfyToMessage(JSON.parse(data) as NtfyEvent, ch.id, installId);
      if (!msg) return;
      // Our own echo: mark the local copy as delivered instead of adding a duplicate.
      if (msg.mine) {
        const local = getState().chat.find((m) => m.channelId === ch.id && m.mine && !m.remoteId && m.text === msg.text);
        if (local) {
          patchMessage(local.id, { remoteId: msg.remoteId, status: 'sent' });
          return;
        }
      }
      addMessages([msg]);
      // A spot in chat marks the sender on the map, unless they're already live-sharing from a phone.
      const live = getState().team.some((t) => t.source === 'phone' && t.channelId === ch.id && t.name === msg.from && Date.now() - t.at < 10 * 60_000);
      if (msg.spot && !msg.mine && !live) upsertMember({ id: `ntfy:${ch.id}:${msg.from}`, name: msg.from, channelId: ch.id, at: msg.at, location: [msg.spot.lon, msg.spot.lat], source: 'ntfy' });
    } catch {
      /* not a message event */
    }
  }
}

async function sendNtfy(ch: NtfyChannel, m: ChatMessage) {
  const s = getState();
  const body = ntfyPublishBody(ch, s.settings.team.callsign || 'Vigilance', m.text, s.settings.team.installId, m.spot, m.url, m.tags, !s.fieldMode);
  const res = await fetch(`${ch.server.replace(/\/$/, '')}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  // The echo may already have arrived and been merged.
  const cur = getState().chat.find((x) => x.id === m.id);
  if (cur && !cur.remoteId) patchMessage(m.id, { remoteId: j.id, status: 'sent' });
}

// ---------- Meshtastic ----------

const nodes = new Map<number, MeshUser>();
let myNode = 0;
let heartbeat: number | undefined;
const nameOf = (num: number) => nodes.get(num)?.longName || nodes.get(num)?.shortName || nodeIdOf(num);

async function meshSendBytes(bytes: Uint8Array) {
  await invoke('mesh_send', { data: Array.from(bytes) });
}

export async function meshConnect() {
  if (!isTauri()) {
    setShared({ meshStatus: { state: 'error', detail: 'Meshtastic radios need the desktop app' } });
    return;
  }
  const r = getState().settings.mesh;
  setShared({ meshStatus: { state: 'connecting', detail: r.transport } });
  try {
    await invoke('mesh_connect', { transport: r.transport, address: r.address });
  } catch (e) {
    setShared({ meshStatus: { state: 'error', detail: String(e) } });
  }
}

export async function meshDisconnect() {
  if (isTauri()) await invoke('mesh_disconnect').catch(() => {});
  setShared({ meshStatus: { state: 'off', detail: '' } });
}

function onMeshFrame(bytes: Uint8Array) {
  let fr;
  try {
    fr = decodeFromRadio(bytes);
  } catch {
    return;
  }
  const s = getState();
  if (fr.kind === 'myInfo') myNode = fr.myNodeNum;
  else if (fr.kind === 'nodeInfo') {
    if (fr.user) nodes.set(fr.num, fr.user);
    if (fr.num === myNode && fr.user) setShared({ meshStatus: { ...getState().meshStatus, node: fr.user.longName || fr.user.shortName } });
    if (fr.position && fr.num !== myNode) {
      const at = (fr.lastHeard ?? fr.position.time ?? 0) * 1000;
      if (Date.now() - at < TEAM_TTL_MS) upsertMember({ id: `mesh:${fr.num}`, name: nameOf(fr.num), channelId: 'mesh', at, location: [fr.position.lon, fr.position.lat], source: 'mesh' });
    }
  } else if (fr.kind === 'channel') {
    if (fr.role > 0) {
      const list = (s.meshStatus.radioChannels ?? []).filter((c) => c.index !== fr.index);
      setShared({ meshStatus: { ...getState().meshStatus, radioChannels: [...list, { index: fr.index, name: fr.name || (fr.index === 0 ? 'Primary' : `Channel ${fr.index}`) }].sort((a, b) => a.index - b.index) } });
    }
  } else if (fr.kind === 'configComplete') {
    log(`TEAM   Meshtastic radio ready (${nodes.size} nodes known)`, 0);
  } else if (fr.kind === 'packet') {
    const p = fr.packet;
    if (!p.payload || p.portnum == null) return;
    if (p.portnum === PORT.TEXT) {
      if (p.from === myNode) return;
      const text = new TextDecoder().decode(p.payload);
      const channels = s.channels.filter((c): c is MeshChannel => c.kind === 'mesh' && c.enabled && c.channelIndex === p.channel);
      const spot = parseSpot(text) ?? undefined;
      const at = (p.rxTime ?? Math.floor(Date.now() / 1000)) * 1000;
      addMessages(channels.map((c) => ({ id: `mesh:${p.from}:${p.id}:${c.id}`, remoteId: `mesh:${p.from}:${p.id}`, channelId: c.id, at, from: nameOf(p.from), text, mine: false, spot, status: 'sent' as const })));
      if (spot) upsertMember({ id: `mesh:${p.from}`, name: nameOf(p.from), channelId: 'mesh', at, location: [spot.lon, spot.lat], source: 'mesh' });
    } else if (p.portnum === PORT.POSITION) {
      const pos = decodePosition(p.payload);
      if (pos && p.from !== myNode) upsertMember({ id: `mesh:${p.from}`, name: nameOf(p.from), channelId: 'mesh', at: Date.now(), location: [pos.lon, pos.lat], source: 'mesh' });
    } else if (p.portnum === PORT.NODEINFO) {
      nodes.set(p.from, decodeUser(p.payload));
    }
  }
}

async function sendMesh(ch: MeshChannel, m: ChatMessage) {
  if (getState().meshStatus.state !== 'connected') throw new Error('radio not connected');
  const { bytes, id } = encodeText(meshText(m.text, m.spot), ch.channelIndex);
  await meshSendBytes(bytes);
  patchMessage(m.id, { status: 'sent', remoteId: `mesh:${myNode}:${id}` });
}

// ---------- Outgoing queue ----------

const inFlight = new Set<string>();

function drainOutgoing() {
  const s = getState();
  for (const m of s.chat) {
    if (!m.mine || m.status !== 'sending' || inFlight.has(m.id)) continue;
    const ch = s.channels.find((c) => c.id === m.channelId);
    if (!ch) {
      patchMessage(m.id, { status: 'failed', error: 'channel removed' });
      continue;
    }
    inFlight.add(m.id);
    (ch.kind === 'ntfy' ? sendNtfy(ch, m) : sendMesh(ch, m))
      .catch((e) => {
        patchMessage(m.id, { status: 'failed', error: String(e instanceof Error ? e.message : e) });
        log(`TEAM   Send failed on ${ch.name}: ${String(e)}`, 1);
      })
      .finally(() => inFlight.delete(m.id));
  }
}

/** Queue a message from any window; the leader sends it. */
export function postToChannel(channelId: string, text: string, extra: Partial<ChatMessage> = {}) {
  const s = getState();
  const m: ChatMessage = { id: `local:${Math.random().toString(36).slice(2, 10)}`, channelId, at: Date.now(), from: s.settings.team.callsign || 'Me', text, mine: true, status: 'sending', ...extra };
  setShared({ chat: [...s.chat, m].slice(-CHAT_MAX) });
}

// ---------- Auto-share serious reports ----------

function shareSignal(sig: Signal, message: string) {
  for (const ch of getState().channels) {
    if (!ch.enabled || !ch.shareAlerts || sig.severity < ch.shareAlerts) continue;
    const spot = sig.location ? { lat: sig.location[1], lon: sig.location[0] } : undefined;
    postToChannel(ch.id, `⚠ ${sig.title} — ${message}`, { spot, url: sig.url });
  }
}

// ---------- Lifecycle (leader only) ----------

function reconcile(s: State) {
  const live = new Set<string>();
  for (const ch of s.channels as TeamChannel[]) {
    if (ch.kind === 'ntfy' && ch.enabled && s.fieldMode) {
      // Field Agent app: its Team page already holds the streams and hands us their events (ingestFieldEvent).
      live.add(ch.id);
      continue;
    }
    if (ch.kind === 'ntfy' && ch.enabled) {
      connectNtfy(ch);
      connectPositions(ch);
      connectOps(ch);
      // The Field Agent app plays voice through its own Radio card; don't play clips twice.
      if (!s.fieldMode) connectVoice(ch);
      connectPhotos(ch);
      live.add(ch.id);
    }
  }
  dropVoice(live);
  dropPhotos(live);
  for (const map of [streams, posStreams, opsStreams])
    for (const [id, st] of map) {
      if (!live.has(id)) {
        st.es.close();
        map.delete(id);
      }
    }
}

export async function startComms() {
  if (isTauri()) {
    await listen<number[]>('mesh:rx', (e) => onMeshFrame(Uint8Array.from(e.payload)));
    await listen<{ state: State['meshStatus']['state']; detail: string }>('mesh:status', (e) => {
      const { state, detail } = e.payload;
      setShared({ meshStatus: { ...getState().meshStatus, state, detail } });
      if (state === 'connected') {
        void meshSendBytes(encodeWantConfig(Math.floor(Math.random() * 1e9))).catch(() => {});
        window.clearInterval(heartbeat);
        heartbeat = window.setInterval(() => void meshSendBytes(encodeHeartbeat()).catch(() => {}), 5 * 60_000);
        log(`TEAM   Meshtastic connected: ${detail}`, 0);
      } else if (state === 'error' || state === 'disconnected') {
        window.clearInterval(heartbeat);
        if (state === 'error') log(`TEAM   Meshtastic: ${detail}`, 1);
      }
    });
    if (getState().settings.mesh.autoConnect && getState().channels.some((c) => c.kind === 'mesh' && c.enabled)) void meshConnect();
  }
  onSignal(shareSignal);
  reconcile(getState());
  drainOutgoing();
  let prev = getState();
  subscribe(() => {
    const s = getState();
    if (s.channels !== prev.channels) reconcile(s);
    if (s.chat !== prev.chat) drainOutgoing();
    prev = s;
  });
}

export const severityForShare: Severity[] = [0, 2, 3, 4];

/** Field Agent app: events its own streams received, processed exactly as the console would. */
export function ingestFieldEvent(kind: 'chat' | 'pos' | 'ops' | 'photo', data: string) {
  const ch = getState().channels.find((c): c is NtfyChannel => c.kind === 'ntfy' && c.enabled);
  if (!ch) return;
  if (kind === 'chat') onChatEvent(ch, data);
  else if (kind === 'pos') onPosEvent(ch, data);
  else if (kind === 'ops') onOpsEvent(ch, data);
  else ingestPhotoEvent(ch, data);
}
