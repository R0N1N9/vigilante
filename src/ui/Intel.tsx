/** Team intel: what each teammate has posted (photos, marks, voice, frequencies), and the team's time-ordered intel sections. */
import { useMemo, useState } from 'react';
import { replayClip } from '../data/engine/voice';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { deviceOf, markLive, MARK_KIND_LABEL } from '../lib/waypoints';
import { ageText } from '../lib/team';
import { fmtMhz, initials, isReconName, memberColor } from '../lib/teamext';
import { FreqList, useTeamFreqs } from './Freqs';
import { Icon } from './Icon';
import { markColor, openMark } from './Marks';
import { PhotoBoard, PhotoThumb } from './Photos';
import { openWaypoint } from './Waypoints';
import type { TeamMember } from '../lib/comms';

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Avatar({ id, name, size = 22 }: { id: string; name: string; size?: number }) {
  return (
    <i className="avatar" style={{ background: memberColor(id), width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {initials(name)}
    </i>
  );
}

/** Everything one teammate (by device id and callsign) has posted. */
export function useAgentIntel(m: TeamMember) {
  const photos = useStore((s) => s.photos);
  const marks = useStore((s) => s.marks);
  const voice = useStore((s) => s.voice);
  const freqs = useTeamFreqs();
  const dev = deviceOf(m.id) ?? '';
  return useMemo(
    () => ({
      photos: photos.filter((p) => p.byId === dev),
      marks: marks.filter((x) => x.byId === dev && markLive(x)),
      voice: voice.filter((v) => v.byId === dev),
      freqs: freqs.filter((f) => f.by === m.name),
    }),
    [photos, marks, voice, freqs, dev, m.name],
  );
}

export function intelSummary(i: ReturnType<typeof useAgentIntel>) {
  const n = (k: number, w: string) => (k ? `${k} ${w}${k > 1 ? 's' : ''}` : '');
  return [n(i.photos.length, 'photo'), n(i.marks.length, 'mark'), n(i.voice.length, 'clip'), n(i.freqs.length, 'freq')].filter(Boolean).join(' · ');
}

/** Per-agent drop-down (agent profile): photos, marks, voice and frequencies, newest first. */
export function AgentIntel({ m }: { m: TeamMember }) {
  const i = useAgentIntel(m);
  const [err, setErr] = useState('');
  if (!i.photos.length && !i.marks.length && !i.voice.length && !i.freqs.length) return <p className="muted small-text">Nothing posted yet.</p>;
  return (
    <div className="agent-intel">
      {i.photos.length > 0 && (
        <div className="intel-group">
          <small>PHOTOS</small>
          <div className="mark-photos">
            {i.photos.slice(0, 12).map((p) => (
              <PhotoThumb key={p.id} p={p} />
            ))}
          </div>
        </div>
      )}
      {i.marks.length > 0 && (
        <div className="intel-group">
          <small>MARKS</small>
          {i.marks.map((x) => (
            <button key={x.id} className="intel-row" onClick={() => openMark(x.id)}>
              <i className="mark-dot" style={{ background: markColor(x) }} />
              <b>{x.name}</b>
              <span className="muted">{isReconName(x.name) ? 'Recon' : MARK_KIND_LABEL[x.kind]} · {hhmm(x.at)}</span>
            </button>
          ))}
        </div>
      )}
      {i.voice.length > 0 && (
        <div className="intel-group">
          <small>VOICE</small>
          {i.voice.map((v) => (
            <button key={v.id} className="intel-row" onClick={() => void replayClip(v).catch((e) => setErr(String(e?.message ?? e)))}>
              <Icon name="play" size={12} />
              <b>{(v.ms / 1000).toFixed(1)} s</b>
              <span className="muted">{hhmm(v.at)}</span>
            </button>
          ))}
        </div>
      )}
      {i.freqs.length > 0 && (
        <div className="intel-group">
          <small>FREQUENCIES</small>
          {i.freqs.map((f) => (
            <div key={`${f.mhz}|${f.mode}`} className="intel-row">
              <Icon name="radio" size={12} />
              <b className="mono">{fmtMhz(f.mhz)}</b>
              <span className="muted">
                {[f.mode, f.label].filter(Boolean).join(' · ')} · {hhmm(f.at)}
              </span>
            </div>
          ))}
        </div>
      )}
      {err && <p className="crit small-text">{err}</p>}
    </div>
  );
}

/** Team intel sections under the roster, newest first, each entry in its poster's colour. */
export function TeamIntel() {
  const photos = useStore((s) => s.photos);
  const voice = useStore((s) => s.voice);
  const marks = useStore((s) => s.marks);
  const waypoints = useStore((s) => s.waypoints);
  const freqs = useTeamFreqs();
  const [err, setErr] = useState('');
  const ops = useMemo(
    () =>
      [
        ...marks.filter((m) => markLive(m)).map((m) => ({ k: 'mark' as const, id: m.id, at: m.at, by: m.by, byId: m.byId, title: m.name, sub: isReconName(m.name) ? 'Recon' : MARK_KIND_LABEL[m.kind], color: markColor(m), where: m.location })),
        ...waypoints.filter((w) => w.state === 'active').map((w) => ({ k: 'wp' as const, id: w.id, at: w.at, by: w.by, byId: '', title: w.name, sub: w.priority === 'urgent' ? 'Waypoint · urgent' : 'Waypoint', color: w.priority === 'urgent' ? '#FF4D4F' : '#3DD6F5', where: w.location })),
      ].sort((a, b) => b.at - a.at),
    [marks, waypoints],
  );
  return (
    <div className="team-intel">
      <details open>
        <summary className="tv-chat-head mono">PHOTO BOARD · {photos.length}</summary>
        <PhotoBoard />
      </details>
      <details>
        <summary className="tv-chat-head mono">VOICE LOG · {voice.length}</summary>
        {voice.map((v) => (
          <button key={v.id} className="intel-row" onClick={() => void replayClip(v).catch((e) => setErr(String(e?.message ?? e)))}>
            <Avatar id={v.byId} name={v.by} size={20} />
            <b style={{ color: memberColor(v.byId) }}>{v.mine ? 'You' : v.by}</b>
            <span className="muted">
              {(v.ms / 1000).toFixed(1)} s · {hhmm(v.at)}
            </span>
          </button>
        ))}
        {!voice.length && <p className="muted small-text">No push-to-talk clips yet.</p>}
        {err && <p className="crit small-text">{err}</p>}
      </details>
      <details>
        <summary className="tv-chat-head mono">MARKS & WAYPOINTS · {ops.length}</summary>
        {ops.map((o) => (
          <div key={o.k + o.id} className="intel-row">
            <i className="mark-dot" style={{ background: o.color }} />
            <button className="link" onClick={() => (o.k === 'mark' ? openMark(o.id) : openWaypoint(o.id))}>
              <b>{o.title}</b>
            </button>
            <span className="muted">
              {o.sub} · <span style={{ color: o.byId ? memberColor(o.byId) : undefined }}>{o.by}</span> · {ageText(Date.now() - o.at)} ago
            </span>
            <button className="btn small" onClick={() => setShared({ focus: { at: Date.now(), center: o.where, zoom: 16, label: o.title } })}>
              Map
            </button>
          </div>
        ))}
        {!ops.length && <p className="muted small-text">No marks or waypoints.</p>}
      </details>
      <details>
        <summary className="tv-chat-head mono">FREQUENCIES · {freqs.length}</summary>
        <FreqList />
      </details>
    </div>
  );
}
