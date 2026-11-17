import { useEffect, useMemo, useRef, useState } from 'react';
import { CHECKIN_TAG, FIELD_CODES, vigilLink, ntfyPublishBody, ntfyStreamUrl, ntfyToMessage, parseInvite, spotUrl, type ChatMessage, type NtfyChannel, type NtfyEvent } from '../lib/comms';
import { openPosition, posTopic, sealPosition, type PositionReport } from '../lib/poscrypt';
import { distanceM, type LonLat } from '../lib/geo';

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
    const r: PositionReport = {
      v: 1,
      id: saved.deviceId,
      n: saved.callsign || 'Phone',
      app: 'field',
      perm: [...(loc ? (['loc'] as const) : []), ...(bat != null ? (['bat'] as const) : [])],
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
        if (since > 30_000 || (moved > 20 && since > 8_000)) void report(p).catch((e) => setErr(`Send failed: ${String(e)}`));
      },
      (e) => setErr(e.code === e.PERMISSION_DENIED ? 'Location permission was denied. Allow it in your browser settings.' : `Location unavailable: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    const beat = window.setInterval(() => {
      if (Date.now() > until) return stop();
      if (fixRef.current && Date.now() - sentAt.current > 60_000) void report(fixRef.current).catch(() => {});
    }, 15_000);
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
      <div className="field">
        <header className="field-head">
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
          <div className="field-card">
            <h2>No team channel yet</h2>
            <p>Open this page from your team's invite link or QR code.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="field">
      <header className="field-head">
        <b>VIGILANCE</b>
        <span>FIELD</span>
        <em className={connected ? 'ok' : ''}>● {ch.name}</em>
      </header>

      <a className="vigil-open" href={vigilLink(ch)}>
        Have the <b>Vigil</b> app? Open this team in Vigil →
      </a>

      <div className="field-card">
        <label>
          <span>Your callsign</span>
          <input value={saved.callsign} onChange={(e) => update({ callsign: e.target.value.slice(0, 32) })} placeholder="e.g. Unit 7" disabled={sharing} />
        </label>
      </div>

      <div className={`field-card share ${sharing ? 'on' : ''}`}>
        {!sharing ? (
          <>
            <h2>Share my location with the team</h2>
            <p>Your position is sent to everyone in <b>{ch.name}</b> about every 30 seconds while this page is open, encrypted so only people with the invite can read it. You can stop any time.</p>
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
              ◌ Go dark
            </button>
          </>
        )}
        {err && <p className="warn">{err}</p>}
      </div>

      {ping > 0 && !sharing && (
        <div className="field-card ping">
          <h2>📍 Check-in requested</h2>
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

      <div className="field-quick">
        <button className="q sos" onClick={() => void quick('sos')}>
          🚨 SOS
        </button>
        <button className="q backup" onClick={() => void quick('backup')}>
          ⚠ Backup
        </button>
        <button className="q" onClick={() => void quick('onscene')}>
          ✓ On scene
        </button>
        <button className="q" onClick={() => void quick('clear')}>
          ✓ All clear
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
            <div>{m.text}</div>
            {m.spot && (
              <a href={spotUrl(m.spot)} target="_blank" rel="noreferrer">
                📍 Open location
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
    </div>
  );
}
