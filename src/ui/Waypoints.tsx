import { useMemo, useState } from 'react';
import { getState, setState, useStore } from '../data/store';
import { sendWaypoint } from '../data/engine/comms';
import { distanceM } from '../lib/geo';
import { agentStatus, ageText } from '../lib/team';
import { ACK_LABEL, deviceOf, directionsLinks, type AckState, type Waypoint, type WaypointPriority } from '../lib/waypoints';
import { Icon } from './Icon';
import { openExternal } from './popout';

const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDist = (m: number) => (m < 1609 ? `${Math.round(m * 3.281).toLocaleString('en-US')} ft` : `${(m / 1609).toFixed(1)} mi`);

export const placeWaypoint = (at: [number, number]) => setState({ modal: 'waypoint', waypointDraft: { at } });
export const openWaypoint = (id: string) => {
  const w = getState().waypoints.find((x) => x.id === id);
  if (w) setState({ modal: 'waypoint', waypointDraft: { at: w.location, id } });
};

function AckChip({ state }: { state?: AckState }) {
  return <span className={`ack ${state ?? 'pending'}`}>{state ? ACK_LABEL[state] : 'Sent'}</span>;
}

/** Status of each assigned agent for one waypoint. */
function Assignees({ w }: { w: Waypoint }) {
  const team = useStore((s) => s.team);
  const now = Date.now();
  const members = team.filter((m) => m.channelId === w.channelId && m.source === 'phone' && (!w.to.length || w.to.includes(deviceOf(m.id) ?? '')));
  const ids = new Set(members.map((m) => deviceOf(m.id)));
  const extra = Object.entries(w.acks).filter(([d]) => !ids.has(d));
  return (
    <div className="wp-agents">
      {members.map((m) => {
        const d = deviceOf(m.id)!;
        const a = w.acks[d];
        return (
          <div key={m.id} className="wp-agent">
            <i className={`led-dot ${agentStatus(m, now)}`} />
            <b>{m.name}</b>
            <span className="muted">{m.location ? fmtDist(distanceM(m.location, w.location)) : 'no location'}</span>
            <AckChip state={a?.state} />
            {a && <span className="muted small-text">{a.auto ? 'by GPS · ' : ''}{ageText(now - a.at)} ago</span>}
          </div>
        );
      })}
      {extra.map(([d, a]) => (
        <div key={d} className="wp-agent">
          <i className="led-dot offline" />
          <b>{a.name}</b>
          <span className="muted">—</span>
          <AckChip state={a.state} />
        </div>
      ))}
      {!members.length && !extra.length && <div className="muted small-text">No assigned agents are sharing right now. They'll get it when they open Vigil or the check-in page.</div>}
    </div>
  );
}

export function WaypointModal() {
  const draft = useStore((s) => s.waypointDraft);
  const existing = useStore((s) => s.waypoints.find((w) => w.id === s.waypointDraft?.id));
  const allChannels = useStore((s) => s.channels);
  // Filter outside the selector: a selector must not return a new array each time.
  const channels = useMemo(() => allChannels.filter((c) => c.kind === 'ntfy' && c.enabled && c.posKey), [allChannels]);
  const team = useStore((s) => s.team);
  const callsign = useStore((s) => s.settings.team.callsign);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<WaypointPriority>('routine');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const agents = useMemo(() => team.filter((m) => m.channelId === channelId && m.source === 'phone' && !m.dark), [team, channelId]);
  if (!draft) return null;
  const close = () => setState({ modal: null, waypointDraft: null });
  const [lon, lat] = draft.at;
  const links = directionsLinks(lat, lon, existing?.name ?? name);

  const send = async (w: Waypoint) => {
    setBusy(true);
    setErr('');
    try {
      await sendWaypoint(w);
      close();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (existing) {
    return (
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div className="modal wide wp-modal" role="dialog" aria-label={`Waypoint ${existing.name}`}>
          <div className="modal-head">
            <h2>
              <Icon name="pin" size={18} className={existing.priority === 'urgent' ? 'crit' : 'accent'} /> {existing.name}
              <span className={`wp-state ${existing.state}`}>{existing.state.toUpperCase()}</span>
              {existing.priority === 'urgent' && <span className="wp-state urgent">URGENT</span>}
            </h2>
            <button className="x" onClick={close} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <section>
              {existing.note && <p>{existing.note}</p>}
              <p className="mono small-text muted">
                {lat.toFixed(5)}, {lon.toFixed(5)} · sent by {existing.by} {ageText(Date.now() - existing.at)} ago · {existing.to.length ? `${existing.to.length} assigned` : 'everyone on the channel'}
              </p>
            </section>
            <section>
              <h3>Agents</h3>
              <Assignees w={existing} />
            </section>
            {err && <p className="crit small-text">{err}</p>}
          </div>
          <div className="modal-foot">
            <button className="btn small" onClick={() => void openExternal(links.google, existing.name)}>
              <Icon name="external" />
              Preview directions
            </button>
            {existing.state === 'active' ? (
              <>
                <button className="btn small" disabled={busy} onClick={() => void send({ ...existing, at: Date.now(), state: 'cancelled' })}>
                  Cancel waypoint
                </button>
                <button className="btn small" disabled={busy} onClick={() => void send({ ...existing, at: Date.now() })}>
                  Resend
                </button>
                <button className="btn small primary" disabled={busy} onClick={() => void send({ ...existing, at: Date.now(), state: 'done' })}>
                  <Icon name="check" />
                  Mark complete
                </button>
              </>
            ) : (
              <button className="btn small primary" disabled={busy} onClick={() => void send({ ...existing, at: Date.now(), state: 'active' })}>
                Reactivate
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wp-modal" role="dialog" aria-label="Place waypoint">
        <div className="modal-head">
          <h2>
            <Icon name="pin" size={18} className="accent" /> New waypoint
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section>
            <p className="mono small-text muted">
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </p>
            {!channels.length ? (
              <p className="warn small-text">Waypoints need a team channel (Team tab → Channels → New ntfy channel). Agents get them in Vigil or on the phone check-in page.</p>
            ) : (
              <>
                <label className="field">
                  <span>Name</span>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Rally point, North gate, Check vehicle…" />
                </label>
                <label className="field">
                  <span>Note (optional)</span>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="What to do there" />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Priority</span>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as WaypointPriority)}>
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  {channels.length > 1 && (
                    <label className="field">
                      <span>Channel</span>
                      <select
                        value={channelId}
                        onChange={(e) => {
                          setChannelId(e.target.value);
                          setTo([]);
                        }}
                      >
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="field">
                  <span>Send to</span>
                  <div className="chips">
                    <button className={`chip ${!to.length ? 'on' : ''}`} onClick={() => setTo([])}>
                      Everyone
                    </button>
                    {agents.map((m) => {
                      const d = deviceOf(m.id)!;
                      return (
                        <button key={m.id} className={`chip ${to.includes(d) ? 'on' : ''}`} onClick={() => setTo(to.includes(d) ? to.filter((x) => x !== d) : [...to, d])}>
                          {m.name}
                          {m.location ? ` · ${fmtDist(distanceM(m.location, draft.at))}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="muted small-text">The location is encrypted with the channel key. Agents get a prompt in Vigil (or on the check-in page) to open turn-by-turn directions, and can answer Acknowledged, En route, Arrived or Can't make it. Arrival is also detected from their GPS within 40 m.</p>
              </>
            )}
            {err && <p className="crit small-text">{err}</p>}
          </section>
        </div>
        <div className="modal-foot">
          <button className="btn small" onClick={close}>
            Cancel
          </button>
          <button
            className="btn small primary"
            disabled={!channels.length || !name.trim() || busy}
            onClick={() => void send({ id: uid(), channelId: channelId || channels[0].id, name: name.trim(), note: note.trim(), location: draft.at, to, priority, state: 'active', by: callsign || 'Ops', at: Date.now(), acks: {} })}
          >
            <Icon name="pin" />
            {busy ? 'Sending…' : 'Send waypoint'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Active waypoints with per-agent status (Team view). */
export function WaypointList() {
  const wps = useStore((s) => s.waypoints);
  const active = wps.filter((w) => w.state === 'active');
  const recent = wps.filter((w) => w.state !== 'active').slice(0, 3);
  if (!wps.length) return null;
  return (
    <div className="wp-list">
      <div className="tv-chat-head mono">WAYPOINTS · {active.length} ACTIVE</div>
      {[...active, ...recent].map((w) => {
        const acks = Object.values(w.acks);
        const arrived = acks.filter((a) => a.state === 'arrived').length;
        return (
          <button key={w.id} className={`wp-row ${w.state} ${w.priority}`} onClick={() => openWaypoint(w.id)}>
            <Icon name="pin" size={15} className={w.priority === 'urgent' ? 'crit' : 'accent'} />
            <b>{w.name}</b>
            <span className="muted small-text">{w.state !== 'active' ? w.state : `${arrived} arrived · ${acks.length} replied · ${w.to.length || 'all'} assigned`}</span>
          </button>
        );
      })}
    </div>
  );
}
