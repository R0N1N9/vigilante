import { FieldFreqs } from './FieldFreqs';
import { PhotoComposer, PhotoStrip, PhotoViewer, useFieldPhotos, type FieldPhoto } from './FieldPhotos';
import { cleanListening, describeDevice, deviceFromUA, isReconName, RATES, reconName, RECON_NOTE, type RateId } from '../lib/teamext';
import { createRoot } from 'react-dom/client';
import { FieldRadio } from './FieldRadio';
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CHECKIN_TAG, FIELD_CODES, fieldLink, newNtfyChannel, vigilLink, ntfyPublishBody, ntfyStreamUrl, ntfyToMessage, parseInvite, spotUrl, type ChatMessage, type NtfyChannel, type NtfyEvent } from '../lib/comms';
import { cleanProfile, openPosition, posTopic, sealPosition, type PositionReport, type Profile } from '../lib/poscrypt';
import { distanceM, type LonLat } from '../lib/geo';
import { ACK_LABEL, directionsLinks, isFor, markLive, MARK_CATEGORIES, MARK_KIND_LABEL, markStateLabel, openOps, opsTopic, PING_TTL_S, sealOps, type AckState, type MarkCategory, type MarkKind, type MarkMessage, type OpsMessage } from '../lib/waypoints';

const MARK_DOT: Record<MarkCategory, string> = { general: '#E6EDF3', hazard: '#FF7A45', entry: '#4C8DFF', rally: '#2BD47D', observation: '#C084FC', vehicle: '#FFD84D', activity: '#FF4D4F', medical: '#FF8FA3', staging: '#7DD3FC' };
import { BrandMark } from './BrandMark';
import { Icon, RichText } from './Icon';

/**
 * Phone check-in page (?view=field#join=…). Runs in any phone browser with no
 * install: join the team channel, chat, send quick status codes and, only if
 * the person turns it on, share live location with the team's console.
 */

const STORE = 'vigilance.field.v1';
interface Saved {
  channel: NtfyChannel | null;
  callsign: string;
  deviceId: string;
  /** Optional role/contact, sent only when shareProfile is on. */
  profile?: Profile;
  shareProfile?: boolean;
  /** Share device type (from the browser) and what I'm monitoring (Vigil's 'device' and 'radio' categories). */
  shareDevice?: boolean;
  shareRadio?: boolean;
  listening?: { f?: number; mode?: string; label?: string };
  /** How often to report while sharing. */
  rate?: RateId;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null;
    if (s?.deviceId) return s;
  } catch {
    /* fresh */
  }
  return { channel: null, callsign: '', deviceId: Math.random().toString(36).slice(2, 12) };
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

async function publish(ch: NtfyChannel, body: object) {
  const res = await fetch(`${ch.server.replace(/\/$/, '')}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1609).toFixed(1)} mi`);

const DURATIONS = [
  { h: 1, label: '1 hour' },
  { h: 4, label: '4 hours' },
  { h: 8, label: '8 hours (a shift)' },
  { h: 12, label: '12 hours' },
];

/** Join with any invite (link, VG1 code, vigil:// link) or start a new team. Works on iPhone and Android: no install. */
function NoTeam({ onJoin, callsign }: { onJoin: (ch: NtfyChannel, callsign: string) => void; callsign: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [call, setCall] = useState(callsign);
  const [err, setErr] = useState('');
  const join = () => {
    const c = parseInvite(code);
    if (!c) return setErr("That isn't a team invite. Paste the whole link or the VG1… code.");
    if (c.kind !== 'ntfy') return setErr('That is a Meshtastic radio channel: join it in the Meshtastic app.');
    if (!call.trim()) return setErr('Enter your callsign first.');
    onJoin(c, call.trim());
  };
  const create = () => {
    if (!name.trim() || !call.trim()) return setErr('Enter a team name and your callsign.');
    onJoin(newNtfyChannel({ name: name.trim().slice(0, 60) }), call.trim());
  };
  return (
    <>
      <div className="field-card">
        <label>
          <span>Your callsign (how your team sees you)</span>
          <input value={call} onChange={(e) => setCall(e.target.value.slice(0, 32))} placeholder="e.g. Unit 7" />
        </label>
      </div>
      <div className="field-card">
        <h2>Join a team</h2>
        <p>Paste the invite link or code someone sent you, or open their link or QR code directly.</p>
        <label>
          <span>Invite link or code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…#join=VG1.… or VG1.…" />
        </label>
        <button className="field-btn go" onClick={join} disabled={!code.trim()}>
          Join team
        </button>
      </div>
      <div className="field-card">
        <h2>Or create a team</h2>
        <p>Makes a new private team channel, the same kind Vigilance makes. Invite people with a QR code or link next. Locations shared in it are end-to-end encrypted.</p>
        <label>
          <span>Team name</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="e.g. Night shift" />
        </label>
        <button className="field-btn" onClick={create} disabled={!name.trim()}>
          Create team
        </button>
      </div>
      {err && <p className="warn">{err}</p>}
      <p className="field-note">
        Works in any phone browser, iPhone or Android, with nothing to install. To keep it like an app: Safari → Share → <b>Add to Home Screen</b> (iPhone), or the
        browser menu → <b>Add to Home screen</b> (Android).
      </p>
    </>
  );
}

/** Invite people: QR code of the phone link, the system share sheet, and copy. */
function InviteCard({ ch, callsign, open }: { ch: NtfyChannel; callsign: string; open: boolean }) {
  const [src, setSrc] = useState('');
  const [copied, setCopied] = useState(false);
  const link = fieldLink(ch);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void QRCode.toDataURL(link, { margin: 2, width: 240, errorCorrectionLevel: link.length > 120 ? 'L' : 'M', color: { dark: '#000000', light: '#ffffff' } }).then(
      (u) => live && setSrc(u),
    );
    return () => {
      live = false;
    };
  }, [link, open]);
  const text = `${callsign ? `${callsign} invited you` : "You're invited"} to the "${ch.name}" team on Vigilance.\n\nOpen on your phone (iPhone or Android, nothing to install): ${link}\n\nHave the Vigil app? ${vigilLink(ch)}\n\nThis link works like a key: please don't forward it.`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Join "${ch.name}" on Vigilance`, text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Copy this link:', link);
    }
  };
  return (
    <div className="field-invite-body">
      <p>Anyone who scans this with their phone camera, or opens the link, joins <b>{ch.name}</b> here (iPhone or Android) or in the Vigil app. Vigilance on a laptop can join with it too.</p>
      <div className="field-qr">{src ? <img src={src} alt={`QR code to join ${ch.name}`} width={240} height={240} /> : null}</div>
      <button className="field-btn go" onClick={() => void share()}>
        Share invite
      </button>
      <button className="field-btn" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className="warn">This invite works like a key: anyone with it can read the chat and the team's shared locations. Send it only to people you trust.</p>
    </div>
  );
}

function FieldMark() {
  return <BrandMark className="field-mark" />;
}

export function FieldApp() {
  const [saved, setSaved] = useState<Saved>(() => {
    const s = load();
    const code = /#join=(.+)$/.exec(location.hash)?.[1];
    const ch = code ? parseInvite(decodeURIComponent(code)) : null;
    if (ch && ch.kind === 'ntfy') {
      const keep = s.channel && s.channel.topic === ch.topic && s.channel.server === ch.server ? s.channel : ch;
      const next = { ...s, channel: { ...ch, id: keep.id } };
      save(next);
      history.replaceState(null, '', location.pathname + location.search);
      return next;
    }
    return s;
  });
  const meshInvite = useMemo(() => {
    const code = /#join=(.+)$/.exec(location.hash)?.[1];
    const ch = code ? parseInvite(decodeURIComponent(code)) : null;
    return ch?.kind === 'mesh' ? ch : null;
  }, []);
  const ch = saved.channel;
  const update = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const n = { ...s, ...patch };
      save(n);
      return n;
    });

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [team, setTeam] = useState<Map<string, PositionReport>>(new Map());
  const [sharing, setSharing] = useState(false);
  const [hours, setHours] = useState(8);
  const [until, setUntil] = useState(0);
  const [fix, setFix] = useState<GeolocationPosition | null>(null);
  const [lastSent, setLastSent] = useState(0);
  const [sent, setSent] = useState(0);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [ping, setPing] = useState(0);
  const [wps, setWps] = useState<Map<string, Extract<OpsMessage, { type: 'wp' }>>>(new Map());
  const [myAcks, setMyAcks] = useState<Record<string, AckState>>({});
  const [marks, setMarks] = useState<Map<string, MarkMessage>>(new Map());
  const fieldPhotos = useFieldPhotos(ch, saved.deviceId);
  const liveMarkList = useMemo(() => [...marks.values()].filter((m) => markLive({ state: m.state, at: m.t, ttlS: m.ttl }) && m.kind !== 'ping').map((m) => ({ id: m.id, name: m.name })), [marks]);
  const [resolveId, setResolveId] = useState('');
  const [foundText, setFoundText] = useState('');
  const [markOpen, setMarkOpen] = useState(false);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FieldPhoto | null>(null);
  const [mk, setMk] = useState<{ kind: MarkKind | 'recon' | 'waypoint'; cat: MarkCategory; name: string; desc: string; r: number }>({ kind: 'marker', cat: 'general', name: '', desc: '', r: 150 });
  const [inviteOpen, setInviteOpen] = useState(false);
  const sentAt = useRef(0);
  const sentWhere = useRef<LonLat | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const fixRef = useRef<GeolocationPosition | null>(null);

  // Chat stream
  useEffect(() => {
    if (!ch) return;
    const es = new EventSource(ntfyStreamUrl(ch, '12h'));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const m = ntfyToMessage(JSON.parse(e.data) as NtfyEvent, ch.id, saved.deviceId);
        if (m) setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-150)));
        if (m && !m.mine && m.tags?.includes(CHECKIN_TAG) && Date.now() - m.at < 5 * 60_000) setPing(m.at);
      } catch {
        /* keepalive */
      }
    };
    return () => es.close();
  }, [ch?.topic, ch?.server, ch?.token, saved.deviceId]);

  // Waypoints from the console (encrypted ops topic)
  useEffect(() => {
    if (!ch?.posKey) return;
    const es = new EventSource(ntfyStreamUrl({ ...ch, topic: opsTopic(ch.topic) }, '24h'));
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as NtfyEvent;
        if (ev.event !== 'message' || !ev.message) return;
        void openOps(ch.posKey, ev.message).then((m) => {
          if (!m) return;
          if (m.type === 'wp') {
            if (!isFor(m, saved.deviceId)) return;
            setWps((cur) => {
              const prev = cur.get(m.id);
              if (prev && prev.t > m.t) return cur;
              const n = new Map(cur);
              n.set(m.id, m);
              if (!prev && m.state === 'active' && Date.now() - m.t < 10 * 60_000) navigator.vibrate?.(m.pri === 'urgent' ? [300, 120, 300, 120, 300] : [200]);
              return n;
            });
          } else if (m.type === 'mark') {
            setMarks((cur) => {
              const prev = cur.get(m.id);
              if (prev && prev.t >= m.t) return cur;
              const n = new Map(cur);
              n.set(m.id, m);
              if (!prev && m.kind === 'ping' && m.byId !== saved.deviceId && Date.now() - m.t < 5 * 60_000) navigator.vibrate?.([120, 80, 120]);
              return n;
            });
          } else if (m.id === saved.deviceId) setMyAcks((a) => ({ ...a, [m.wp]: m.state }));
        });
      } catch {
        /* keepalive */
      }
    };
    return () => es.close();
  }, [ch?.topic, ch?.posKey, saved.deviceId]);

  const ackWaypoint = async (wp: string, state: AckState) => {
    if (!ch?.posKey) return;
    setMyAcks((a) => ({ ...a, [wp]: state }));
    try {
      await publish(ch, { topic: opsTopic(ch.topic), message: await sealOps(ch.posKey, { v: 1, type: 'wp-ack', wp, id: saved.deviceId, n: saved.callsign || 'Phone', state, t: Date.now() }), tags: ['vigilance-ops'] });
    } catch (e) {
      setErr(`Reply not sent: ${String(e)}`);
    }
  };
  const isApple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);

  // Teammates' positions (decrypted on the phone too)
  useEffect(() => {
    if (!ch?.posKey) return;
    const es = new EventSource(ntfyStreamUrl({ ...ch, topic: posTopic(ch.topic) }, '1h'));
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as NtfyEvent;
        if (ev.event !== 'message' || !ev.message) return;
        void openPosition(ch.posKey, ev.message).then((r) => {
          if (!r || r.id === saved.deviceId) return;
          if (r.s === 'on' && r.lat == null) return; // presence only: nothing to place
          setTeam((t) => {
            const n = new Map(t);
            if (r.s === 'off') n.delete(r.id);
            else if (!n.get(r.id) || n.get(r.id)!.t <= r.t) n.set(r.id, r);
            return n;
          });
        });
      } catch {
        /* keepalive */
      }
    };
    return () => es.close();
  }, [ch?.topic, ch?.posKey, saved.deviceId]);

  const report = async (pos: GeolocationPosition | null, state: 'on' | 'off' | 'dark' = 'on') => {
    if (!ch?.posKey) return;
    let bat: number | undefined;
    try {
      const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
      if (b) bat = Math.round(b.level * 100);
    } catch {
      /* not supported */
    }
    const loc = pos && state === 'on';
    const prof = saved.shareProfile && saved.profile ? cleanProfile(saved.profile) : undefined;
    const on = state === 'on';
    const dev = on && saved.shareDevice ? deviceFromUA(navigator.userAgent) : undefined;
    const radio = on && saved.shareRadio && saved.listening?.f ? cleanListening(saved.listening) : undefined;
    const r: PositionReport = {
      v: 1,
      id: saved.deviceId,
      n: saved.callsign || 'Phone',
      app: 'field',
      perm: [...(loc ? (['loc'] as const) : []), ...(bat != null ? (['bat'] as const) : []), ...(prof && state === 'on' ? (['profile'] as const) : []), ...(dev ? (['device'] as const) : []), ...(radio ? (['radio'] as const) : [])],
      ...(prof && state === 'on' ? { prof } : {}),
      ...(dev ? { dev } : {}),
      ...(radio ? { radio } : {}),
      ...(loc
        ? {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc: Math.round(pos.coords.accuracy),
            ...(pos.coords.speed != null ? { spd: +pos.coords.speed.toFixed(1) } : {}),
            ...(pos.coords.heading != null && !Number.isNaN(pos.coords.heading) ? { hdg: Math.round(pos.coords.heading) } : {}),
          }
        : {}),
      ...(bat != null && state === 'on' ? { bat } : {}),
      t: Date.now(),
      s: state,
    };
    await publish(ch, { topic: posTopic(ch.topic), message: await sealPosition(ch.posKey, r), tags: ['vigilance-pos'] });
    sentAt.current = Date.now();
    if (r.lat != null && r.lon != null) sentWhere.current = [r.lon, r.lat];
    setLastSent(Date.now());
    setSent((n) => n + 1);
  };

  // Location sharing loop (only while the person has it switched on)
  useEffect(() => {
    if (!sharing) return;
    if (!('geolocation' in navigator)) {
      setErr('This browser has no location access.');
      setSharing(false);
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        fixRef.current = p;
        setFix(p);
        setErr('');
        const here: LonLat = [p.coords.longitude, p.coords.latitude];
        const moved = sentWhere.current ? distanceM(sentWhere.current, here) : Infinity;
        const since = Date.now() - sentAt.current;
        const rt = RATES[saved.rate ?? 'normal'];
        if (since > rt.heartbeatS * 1000 || (moved > rt.moveM && since > rt.minS * 1000)) void report(p).catch((e) => setErr(`Send failed: ${String(e)}`));
      },
      (e) => setErr(e.code === e.PERMISSION_DENIED ? 'Location permission was denied. Allow it in your browser settings.' : `Location unavailable: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    const beat = window.setInterval(() => {
      if (Date.now() > until) return stop();
      if (fixRef.current && Date.now() - sentAt.current > RATES[saved.rate ?? 'normal'].heartbeatS * 1000) void report(fixRef.current).catch(() => {});
    }, 5_000);
    const lock = async () => {
      try {
        wake.current = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* not supported */
      }
    };
    void lock();
    const vis = () => document.visibilityState === 'visible' && void lock();
    document.addEventListener('visibilitychange', vis);
    return () => {
      navigator.geolocation.clearWatch(watch);
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', vis);
      void wake.current?.release().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing]);

  // Console asked for a check-in: answer right away if sharing; otherwise ask the person.
  useEffect(() => {
    if (!ping) return;
    if (sharing && fixRef.current) {
      void report(fixRef.current).catch(() => {});
      setPing(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping]);
  const answerOnce = async () => {
    setPing(0);
    try {
      const p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }));
      fixRef.current = p;
      setFix(p);
      await report(p);
    } catch (e) {
      setErr(`Couldn't send location: ${String(e instanceof Error ? e.message : e)}`);
    }
  };
  const goDark = () => {
    setSharing(false);
    void report(null, 'dark').catch(() => {});
  };

  /** Place a mark at this phone's position (pings use the same path with kind 'ping'). */
  /** Send the team here: a waypoint at my location to everyone (Vigil and the console accept it). */
  const sendWaypointHere = async () => {
    if (!ch?.posKey) return;
    let p = fixRef.current;
    if (!p || Date.now() - p.timestamp > 60_000) {
      try {
        p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }));
        fixRef.current = p;
        setFix(p);
      } catch {
        return setErr('Location is needed for a waypoint. Allow it in your browser settings.');
      }
    }
    const w = { v: 1 as const, type: 'wp' as const, id: Math.random().toString(36).slice(2, 10), name: (mk.name.trim() || 'Waypoint').slice(0, 60), note: mk.desc.trim().slice(0, 300), lat: p.coords.latitude, lon: p.coords.longitude, to: [], pri: 'routine' as const, state: 'active' as const, by: saved.callsign || 'Phone', t: Date.now() };
    try {
      await publish(ch, { topic: opsTopic(ch.topic), message: await sealOps(ch.posKey, w), tags: ['vigilance-ops'] });
      setMk((x) => ({ ...x, name: '', desc: '' }));
      setMarkOpen(false);
    } catch (e) {
      setErr(`Waypoint not sent: ${String(e)}`);
    }
  };
  const placeMark = async (kind: MarkKind, extra: Partial<MarkMessage> = {}) => {
    if (!ch?.posKey) return setErr('This invite is from an older version and can’t carry marks. Ask for a new one.');
    let p = fixRef.current;
    if (!p || Date.now() - p.timestamp > 60_000) {
      try {
        p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }));
        fixRef.current = p;
        setFix(p);
      } catch {
        return setErr('Location is needed to place a mark. Allow it in your browser settings.');
      }
    }
    const msg: MarkMessage = {
      v: 1,
      type: 'mark',
      id: Math.random().toString(36).slice(2, 10),
      kind,
      cat: kind === 'ping' ? 'general' : mk.cat,
      name: (kind === 'ping' ? 'Ping' : mk.name.trim() || (kind === 'objective' ? 'Objective' : kind === 'investigate' ? 'Check this out' : MARK_CATEGORIES[mk.cat])).slice(0, 60),
      desc: (kind === 'ping' ? mk.desc : mk.desc).trim().slice(0, 500),
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      ...(kind === 'area' ? { r: mk.r } : {}),
      state: 'active',
      by: saved.callsign || 'Phone',
      byId: saved.deviceId,
      t: Date.now(),
      ...(kind === 'ping' ? { ttl: PING_TTL_S } : {}),
      ...extra,
    };
    try {
      await publish(ch, { topic: opsTopic(ch.topic), message: await sealOps(ch.posKey, msg), tags: ['vigilance-ops'] });
      setMarks((cur) => new Map(cur).set(msg.id, msg));
      setMk((x) => ({ ...x, name: '', desc: '' }));
      setMarkOpen(false);
    } catch (e) {
      setErr(`Mark not sent: ${String(e)}`);
    }
  };
  const clearMark = (m: MarkMessage) => updateMark(m, { state: 'cleared' });
  const updateMark = async (m: MarkMessage, patch: Partial<MarkMessage>) => {
    if (!ch?.posKey) return;
    const next: MarkMessage = { ...m, ...patch, by: saved.callsign || 'Phone', byId: saved.deviceId, t: Date.now() };
    setMarks((cur) => new Map(cur).set(m.id, next));
    await publish(ch, { topic: opsTopic(ch.topic), message: await sealOps(ch.posKey, next), tags: ['vigilance-ops'] }).catch(() => {});
  };

  const start = () => {
    if (!saved.callsign.trim()) {
      setErr('Enter your callsign first so the team knows who you are.');
      return;
    }
    setUntil(Date.now() + hours * 3600_000);
    setSharing(true);
  };
  const stop = () => {
    setSharing(false);
    if (fixRef.current) void report(fixRef.current, 'off').catch(() => {});
  };

  const sendChat = async (msg: string, withSpot = false) => {
    if (!ch || !msg.trim()) return;
    const p = fixRef.current;
    const spot = withSpot && p ? { lat: p.coords.latitude, lon: p.coords.longitude } : undefined;
    try {
      await publish(ch, ntfyPublishBody(ch, saved.callsign || 'Phone', msg.trim(), saved.deviceId, spot));
    } catch (e) {
      setErr(`Message not sent: ${String(e)}`);
    }
  };
  const quick = async (k: keyof typeof FIELD_CODES) => {
    if (k === 'sos' && !confirm('Send an EMERGENCY alert with your location to the whole team?')) return;
    if (!fixRef.current) {
      try {
        fixRef.current = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
        setFix(fixRef.current);
      } catch {
        /* send without location */
      }
    }
    await sendChat(`${FIELD_CODES[k].text} — ${saved.callsign || 'Phone'}`, true);
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);
  const me: LonLat | null = fix ? [fix.coords.longitude, fix.coords.latitude] : null;

  if (!ch) {
    return (
      <div className="fieldapp">
        <header className="field-head">
          <FieldMark />
          <b>VIGILANCE</b>
          <span>FIELD</span>
        </header>
        {meshInvite ? (
          <div className="field-card">
            <h2>Meshtastic channel</h2>
            <p>This invite is for a radio channel. {meshInvite.inviteUrl ? 'Open the link below on this phone with the Meshtastic app installed, so your radio joins the encrypted channel.' : 'Ask your team lead for the channel link from the Meshtastic app.'}</p>
            {meshInvite.inviteUrl && (
              <a className="field-btn" href={meshInvite.inviteUrl}>
                Open in Meshtastic
              </a>
            )}
          </div>
        ) : (
          <NoTeam callsign={saved.callsign} onJoin={(c, call) => update({ channel: c, callsign: call })} />
        )}
      </div>
    );
  }

  return (
    <div className="fieldapp">
      <header className="field-head">
        <FieldMark />
        <b>VIGILANCE</b>
        <span>FIELD</span>
        <em className={connected ? 'ok' : ''}>● {ch.name}</em>
      </header>

      <a className="vigil-open" href={vigilLink(ch)}>
        Have the <b>Vigil</b> app? Open this team in Vigil →
      </a>

      <details className="field-card field-invite" onToggle={(e) => setInviteOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <b>Invite people</b> · QR code or link
        </summary>
        <InviteCard ch={ch} callsign={saved.callsign} open={inviteOpen} />
      </details>

      <div className="field-card">
        <label>
          <span>Your callsign</span>
          <input value={saved.callsign} onChange={(e) => update({ callsign: e.target.value.slice(0, 32) })} placeholder="e.g. Unit 7" disabled={sharing} />
        </label>
        <details className="field-profile">
          <summary>Role and contact (optional)</summary>
          {(['role', 'unit', 'phone', 'email'] as const).map((k) => (
            <label key={k}>
              <span>{{ role: 'Role (e.g. Team lead, Medic)', unit: 'Unit / post', phone: 'Phone', email: 'Email' }[k]}</span>
              <input
                type={k === 'phone' ? 'tel' : k === 'email' ? 'email' : 'text'}
                value={saved.profile?.[k] ?? ''}
                onChange={(e) => update({ profile: { ...(saved.profile ?? {}), [k]: e.target.value.slice(0, k === 'email' ? 80 : 40) } })}
              />
            </label>
          ))}
          <label className="check-row">
            <input type="checkbox" checked={!!saved.shareProfile} onChange={(e) => update({ shareProfile: e.target.checked })} />
            <span>Share my role and contact details with the team while I'm sharing</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={!!saved.shareDevice} onChange={(e) => update({ shareDevice: e.target.checked })} />
            <span>Share my device type ({describeDevice(deviceFromUA(navigator.userAgent), 'field')})</span>
          </label>
          <div className="freq-row">
            <label>
              <span>I'm monitoring (MHz)</span>
              <input inputMode="decimal" value={saved.listening?.f ?? ''} onChange={(e) => update({ listening: { ...saved.listening, f: Number(e.target.value.replace(/[^0-9.]/g, '')) || undefined } })} placeholder="462.5625" />
            </label>
            <label>
              <span>Label</span>
              <input value={saved.listening?.label ?? ''} onChange={(e) => update({ listening: { ...saved.listening, label: e.target.value.slice(0, 40) } })} placeholder="Team channel" />
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={!!saved.shareRadio} onChange={(e) => update({ shareRadio: e.target.checked })} />
            <span>Share what I'm listening to</span>
          </label>
        </details>
      </div>

      <div className={`field-card share ${sharing ? 'on' : ''}`}>
        {!sharing ? (
          <>
            <h2>Share my location with the team</h2>
            <p>Your position is sent to everyone in <b>{ch.name}</b> while this page is open ({RATES[saved.rate ?? 'normal'].note.toLowerCase()}), encrypted so only people with the invite can read it. You can stop any time.</p>
            <label>
              <span>Stop automatically after</span>
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.h} value={d.h}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Update rate</span>
              <select value={saved.rate ?? 'normal'} onChange={(e) => update({ rate: e.target.value as RateId })}>
                {(Object.keys(RATES) as RateId[]).map((k) => (
                  <option key={k} value={k}>
                    {RATES[k].label}
                  </option>
                ))}
              </select>
            </label>
            <button className="field-btn go" onClick={start} disabled={!ch.posKey}>
              Start sharing
            </button>
            {!ch.posKey && <p className="warn">This invite is from an older version and can't carry locations. Ask for a new one.</p>}
          </>
        ) : (
          <>
            <h2>
              <i className="live-dot" /> Sharing live
            </h2>
            <p className="mono">
              {fix ? `±${Math.round(fix.coords.accuracy)} m · ` : 'Waiting for GPS… · '}
              {lastSent ? `sent ${fmtAge(lastSent)} ago · ${sent} updates` : 'not sent yet'} · until {new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
            <p className="hint">Keep this page open with the screen on. Phones pause location for pages in the background.</p>
            <button className="field-btn stop" onClick={stop}>
              Stop sharing
            </button>
            <button className="field-btn dark" onClick={goDark} title="Hide yourself from the team map immediately; the console keeps no last position">
              <Icon name="eyeoff" size={16} />Go dark
            </button>
          </>
        )}
        {err && <p className="warn">{err}</p>}
      </div>

      {[...wps.values()]
        .filter((w) => w.state === 'active')
        .sort((a, b) => Number(b.pri === 'urgent') - Number(a.pri === 'urgent') || b.t - a.t)
        .map((w) => {
          const links = directionsLinks(w.lat, w.lon, w.name);
          const mine = myAcks[w.id];
          return (
            <div key={w.id} className={`field-card wp ${w.pri}`}>
              <h2>
                <Icon name="pin" size={18} className={w.pri === 'urgent' ? 'crit' : 'accent'} /> {w.name}
                {w.pri === 'urgent' && <span className="wp-urgent">URGENT</span>}
              </h2>
              {w.note && <p>{w.note}</p>}
              <p className="mono small">
                From {w.by}
                {fix ? ` · ${fmtDist(distanceM([fix.coords.longitude, fix.coords.latitude], [w.lon, w.lat]))} away` : ''}
                {mine ? ` · you: ${ACK_LABEL[mine].toLowerCase()}` : ''}
              </p>
              <a
                className="field-btn go"
                href={isApple ? links.apple : links.google}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  if (!mine || mine === 'ack') void ackWaypoint(w.id, 'enroute');
                }}
              >
                <Icon name="pin" size={16} />
                Directions
              </a>
              <div className="wp-acks">
                {(['ack', 'enroute', 'arrived', 'declined'] as AckState[]).map((s) => (
                  <button key={s} className={`q ${mine === s ? 'on' : ''}`} onClick={() => void ackWaypoint(w.id, s)}>
                    {ACK_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

      {ping > 0 && !sharing && (
        <div className="field-card ping">
          <h2>
            <Icon name="pin" size={18} className="crit" /> Check-in requested
          </h2>
          <p>The console asked the team for a location update. Sending is up to you.</p>
          <div className="row">
            <button className="field-btn go" onClick={() => void answerOnce()}>
              Send my location once
            </button>
            <button className="field-btn" onClick={() => setPing(0)}>
              Ignore
            </button>
          </div>
        </div>
      )}

      <div className="field-card marks-card">
        <div className="marks-head">
          <h3>Marks</h3>
          <button className="field-btn ping-btn" onClick={() => void placeMark('ping')} disabled={!ch.posKey}>
            <Icon name="target" size={16} />
            Ping my location
          </button>
        </div>
        {!markOpen ? (
          <button className="field-btn" onClick={() => setMarkOpen(true)} disabled={!ch.posKey}>
            <Icon name="pin" size={16} />
            Mark this spot…
          </button>
        ) : (
          <div className="mark-form">
            <div className="wp-acks">
              {(['marker', 'investigate', 'recon', 'area', 'objective', 'waypoint'] as const).map((k) => (
                <button key={k} className={`q ${mk.kind === k ? 'on' : ''}`} onClick={() => setMk({ ...mk, kind: k })}>
                  {k === 'recon' ? 'Recon' : k === 'waypoint' ? 'Waypoint' : MARK_KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <label>
              <span>Category</span>
              <select value={mk.cat} onChange={(e) => setMk({ ...mk, cat: e.target.value as MarkCategory })}>
                {(Object.keys(MARK_CATEGORIES) as MarkCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {MARK_CATEGORIES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Name</span>
              <input value={mk.name} onChange={(e) => setMk({ ...mk, name: e.target.value.slice(0, 60) })} placeholder="Side gate, blue van, water main…" />
            </label>
            <label>
              <span>Description</span>
              <textarea rows={3} value={mk.desc} onChange={(e) => setMk({ ...mk, desc: e.target.value.slice(0, 500) })} placeholder="What is there, or what to do. Describe things and activity, not who someone is." />
            </label>
            {mk.kind === 'area' && (
              <label>
                <span>Radius</span>
                <select value={mk.r} onChange={(e) => setMk({ ...mk, r: Number(e.target.value) })}>
                  {[50, 100, 150, 250, 500, 1000, 2000].map((r) => (
                    <option key={r} value={r}>
                      {r < 1000 ? `${r} m` : `${r / 1000} km`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row">
              <button className="field-btn" onClick={() => setMarkOpen(false)}>
                Cancel
              </button>
              <button className="field-btn go" onClick={() => void (mk.kind === 'waypoint' ? sendWaypointHere() : mk.kind === 'recon' ? placeMark('investigate', { name: reconName(mk.name), cat: 'observation', desc: mk.desc.trim() || RECON_NOTE }) : placeMark(mk.kind))} disabled={!mk.name.trim() && !mk.desc.trim()}>
                Place at my location
              </button>
            </div>
          </div>
        )}
        {[...marks.values()]
          .filter((m) => markLive({ state: m.state, at: m.t, ttlS: m.ttl }))
          .sort((a, b) => (me ? distanceM(me, [a.lon, a.lat]) - distanceM(me, [b.lon, b.lat]) : b.t - a.t))
          .slice(0, 12)
          .map((m) => (
            <div key={m.id} className={`mark-item ${m.kind}`}>
              <i className={`mark-dot ${m.kind === 'investigate' ? 'q' : ''}`} style={{ background: m.kind === 'ping' ? '#3DD6F5' : m.kind === 'objective' ? '#FBBF24' : m.kind === 'investigate' ? '#A78BFA' : MARK_DOT[m.cat] }} />
              <div>
                <b>{m.kind === 'ping' && (!m.name || m.name === 'Ping') ? `Ping from ${m.by}` : m.name}</b>
                <small>
                  {m.kind === 'ping' ? 'ping' : m.kind === 'objective' || m.kind === 'investigate' ? `${m.kind} · ${markStateLabel(m.kind, m.state).toLowerCase()}${m.kind === 'investigate' && m.state === 'progress' ? ` by ${m.by}` : ''}` : `${MARK_KIND_LABEL[m.kind].toLowerCase()} · ${MARK_CATEGORIES[m.cat].toLowerCase()}`}
                  {me ? ` · ${fmtDist(distanceM(me, [m.lon, m.lat]))}` : ''} · {m.by} · {fmtAge(m.t)} ago
                </small>
                {m.desc && <p>{m.desc}</p>}
                <PhotoStrip photos={fieldPhotos.photos.filter((p) => p.meta.mark === m.id)} onOpen={setViewing} />
                {m.res && (
                  <p>
                    <b>Found:</b> {m.res}
                  </p>
                )}
                {resolveId === m.id && (
                  <div className="mark-form">
                    <textarea autoFocus rows={2} value={foundText} onChange={(e) => setFoundText(e.target.value.slice(0, 500))} placeholder="What did you find?" />
                    <div className="row">
                      <button className="field-btn" onClick={() => setResolveId('')}>
                        Cancel
                      </button>
                      <button
                        className="field-btn go"
                        onClick={() => {
                          void updateMark(m, { state: 'done', res: foundText.trim() || undefined });
                          setResolveId('');
                          setFoundText('');
                        }}
                      >
                        Resolved
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="mark-actions">
                <a href={isApple ? directionsLinks(m.lat, m.lon, m.name).apple : directionsLinks(m.lat, m.lon, m.name).google} target="_blank" rel="noreferrer">
                  Go
                </a>
                {m.kind === 'investigate' && m.state === 'active' && <button className="hi" onClick={() => void updateMark(m, { state: 'progress' })}>I'll check</button>}
                {m.kind === 'investigate' && m.state !== 'done' && <button className="hi" onClick={() => setResolveId(m.id)}>Resolve</button>}
                <button className={isReconName(m.name) ? 'hi' : ''} onClick={() => setPhotoFor(m.id)}>
                  {isReconName(m.name) ? 'Post photo' : 'Photo'}
                </button>
                <button onClick={() => void clearMark(m)}>Clear</button>
              </div>
            </div>
          ))}
      </div>

      {ch.posKey && (
        <div className="field-card photos-card">
          <div className="marks-head">
            <h3>Photos</h3>
            {photoFor === null && (
              <button className="field-btn ping-btn" onClick={() => setPhotoFor('')}>
                <Icon name="camera" size={16} />
                Take a photo
              </button>
            )}
          </div>
          {photoFor !== null && (
            <PhotoComposer
              marks={liveMarkList}
              initialMark={photoFor || undefined}
              onClose={() => setPhotoFor(null)}
              onPost={async (file, cap, mark) => {
                const m = mark ? marks.get(mark) : undefined;
                const here = fixRef.current;
                await fieldPhotos.post(file, { n: saved.callsign || 'Phone', byId: saved.deviceId, cap: cap.trim(), ...(m ? { mark: m.id, lat: m.lat, lon: m.lon } : here ? { lat: here.coords.latitude, lon: here.coords.longitude } : {}) });
              }}
            />
          )}
          <PhotoStrip photos={fieldPhotos.photos.slice(0, 24)} onOpen={setViewing} />
          {!fieldPhotos.photos.length && photoFor === null && <p className="small-text muted">No photos yet.</p>}
        </div>
      )}
      {viewing && <PhotoViewer p={viewing} onClose={() => setViewing(null)} markName={viewing.meta.mark ? marks.get(viewing.meta.mark)?.name : undefined} />}

      <FieldFreqs chat={chat} callsign={saved.callsign} onSend={(t) => sendChat(t)} />

      {ch.posKey && <FieldRadio ch={ch} callsign={saved.callsign} deviceId={saved.deviceId} />}

      <div className="field-quick">
        <button className="q sos" onClick={() => void quick('sos')}>
          <Icon name="siren" size={18} />SOS
        </button>
        <button className="q backup" onClick={() => void quick('backup')}>
          <Icon name="warning" size={18} />Backup
        </button>
        <button className="q" onClick={() => void quick('onscene')}>
          <Icon name="check" size={18} />On scene
        </button>
        <button className="q" onClick={() => void quick('clear')}>
          <Icon name="check" size={18} />All clear
        </button>
      </div>

      {team.size > 0 && (
        <div className="field-card">
          <h3>Team on the map</h3>
          {[...team.values()].map((r) =>
            r.s === 'dark' || r.lat == null || r.lon == null ? (
              <div key={r.id} className="field-mate">
                <b>{r.n}</b>
                <span>dark</span>
                <span>{fmtAge(r.t)} ago</span>
                <span />
              </div>
            ) : (
              <div key={r.id} className="field-mate">
                <b>{r.n}</b>
                <span>{me ? fmtDist(distanceM(me, [r.lon, r.lat])) : ''}</span>
                <span>{fmtAge(r.t)} ago</span>
                <a href={spotUrl({ lat: r.lat, lon: r.lon })} target="_blank" rel="noreferrer">
                  Map ↗
                </a>
              </div>
            ),
          )}
        </div>
      )}

      <div className="field-chat" ref={listRef}>
        {chat.map((m) => (
          <div key={m.id} className={`fmsg ${m.mine ? 'mine' : ''}`}>
            <div className="meta">
              <b>{m.mine ? 'You' : m.from}</b> {new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
            <div>
              <RichText text={m.text} />
            </div>
            {m.spot && (
              <a href={spotUrl(m.spot)} target="_blank" rel="noreferrer">
                <Icon name="pin" size={13} />Open location
              </a>
            )}
          </div>
        ))}
        {!chat.length && <p className="hint">No messages yet.</p>}
      </div>
      <form
        className="field-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void sendChat(text);
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the team" />
        <button className="field-btn" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
      <button
        className="field-leave"
        onClick={() => {
          if (!confirm(`Leave ${ch.name}? This removes the team from this phone. You'll need an invite to rejoin.`)) return;
          if (sharing) stop();
          update({ channel: null });
        }}
      >
        Leave team
      </button>
    </div>
  );
}
export function mountFieldApp() { createRoot(document.getElementById('root')!).render(<FieldApp />); }
