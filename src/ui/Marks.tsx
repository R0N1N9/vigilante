import { useMemo, useState } from 'react';
import { getState, setState, useStore } from '../data/store';
import { sendMark } from '../data/engine/comms';
import { ageText } from '../lib/team';
import { directionsLinks, markLive, MARK_CATEGORIES, MARK_KIND_LABEL, MARK_STATE_LABEL, PING_TTL_S, type Mark, type MarkCategory, type MarkKind, type MarkState } from '../lib/waypoints';
import { Icon } from './Icon';
import { openExternal } from './popout';
import { placeWaypoint } from './Waypoints';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Category colors, shared with the map layers. */
export const MARK_COLOR: Record<MarkCategory, string> = {
  general: '#E6EDF3',
  hazard: '#FF7A45',
  entry: '#4C8DFF',
  rally: '#2BD47D',
  observation: '#C084FC',
  vehicle: '#FFD84D',
  activity: '#FF4D4F',
  medical: '#FF8FA3',
  staging: '#7DD3FC',
};
export const OBJECTIVE_COLOR = '#FBBF24';
export const PING_COLOR = '#3DD6F5';
export const markColor = (m: Pick<Mark, 'kind' | 'cat'>) => (m.kind === 'ping' ? PING_COLOR : m.kind === 'objective' ? OBJECTIVE_COLOR : MARK_COLOR[m.cat] ?? '#E6EDF3');

export const newMarkAt = (at: [number, number], kind: MarkKind) => setState({ modal: 'mark', markDraft: { at, kind } });
export const openMark = (id: string) => {
  const m = getState().marks.find((x) => x.id === id);
  if (m) setState({ modal: 'mark', markDraft: { at: m.location, id } });
};

const KINDS: MarkKind[] = ['ping', 'marker', 'area', 'objective'];
const DESC_HINT = 'Describe what is there or what to do. Describe things and activity, not who someone is.';

export function MarkModal() {
  const draft = useStore((s) => s.markDraft);
  const existing = useStore((s) => s.marks.find((m) => m.id === s.markDraft?.id));
  const allChannels = useStore((s) => s.channels);
  const channels = useMemo(() => allChannels.filter((c) => c.kind === 'ntfy' && c.enabled && c.posKey), [allChannels]);
  const settings = useStore((s) => s.settings.team);
  const [kind, setKind] = useState<MarkKind>(draft?.kind ?? 'marker');
  const [cat, setCat] = useState<MarkCategory>(existing?.cat ?? 'general');
  const [name, setName] = useState(existing?.name ?? '');
  const [desc, setDesc] = useState(existing?.desc ?? '');
  const [radius, setRadius] = useState(existing?.radiusM ?? 150);
  const [channelId, setChannelId] = useState(existing?.channelId ?? channels[0]?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!draft) return null;
  const close = () => setState({ modal: null, markDraft: null });
  const [lon, lat] = draft.at;
  const me = { by: settings.callsign || 'Ops', byId: settings.installId };

  const save = async (m: Mark) => {
    setBusy(true);
    setErr('');
    try {
      await sendMark(m);
      close();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<Mark>) => existing && void save({ ...existing, ...patch, ...me, at: Date.now() });

  if (existing && !editing) {
    const live = markLive(existing);
    const links = directionsLinks(lat, lon, existing.name);
    return (
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div className="modal wide mark-modal" role="dialog" aria-label={`${MARK_KIND_LABEL[existing.kind]} ${existing.name}`}>
          <div className="modal-head">
            <h2>
              <i className="mark-dot" style={{ background: markColor(existing) }} /> {existing.name}
              <span className="wp-state">{MARK_KIND_LABEL[existing.kind].toUpperCase()}</span>
              {existing.kind !== 'ping' && <span className="wp-state">{MARK_CATEGORIES[existing.cat].toUpperCase()}</span>}
              <span className={`wp-state ${existing.state === 'done' ? 'done' : live ? 'active' : ''}`}>{live ? MARK_STATE_LABEL[existing.state].toUpperCase() : 'EXPIRED'}</span>
            </h2>
            <button className="x" onClick={close} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <section>
              {existing.desc ? <p className="mark-desc">{existing.desc}</p> : <p className="muted">No description.</p>}
              <p className="mono small-text muted">
                {lat.toFixed(5)}, {lon.toFixed(5)}
                {existing.radiusM ? ` · radius ${Math.round(existing.radiusM)} m` : ''} · by {existing.by} {ageText(Date.now() - existing.at)} ago
                {existing.ttlS ? ` · expires in ${ageText(existing.at + existing.ttlS * 1000 - Date.now())}` : ''}
              </p>
            </section>
            {err && <p className="crit small-text">{err}</p>}
          </div>
          <div className="modal-foot">
            <button className="btn small" onClick={() => void openExternal(links.google, existing.name)}>
              <Icon name="external" />
              Directions
            </button>
            <button
              className="btn small"
              onClick={() => {
                close();
                placeWaypoint(existing.location);
              }}
              title="Send agents here as a waypoint"
            >
              <Icon name="pin" />
              Send agents here
            </button>
            <button className="btn small" onClick={() => setEditing(true)}>
              <Icon name="pencil" />
              Edit
            </button>
            {existing.kind === 'objective' && existing.state !== 'progress' && existing.state !== 'done' && (
              <button className="btn small" disabled={busy} onClick={() => update({ state: 'progress' })}>
                In progress
              </button>
            )}
            {existing.kind === 'objective' && existing.state !== 'done' && (
              <button className="btn small primary" disabled={busy} onClick={() => update({ state: 'done' })}>
                <Icon name="check" />
                Done
              </button>
            )}
            <button className="btn small" disabled={busy} onClick={() => update({ state: 'cleared' })}>
              Clear
            </button>
          </div>
        </div>
      </div>
    );
  }

  const k = existing?.kind ?? kind;
  const submit = () => {
    const cid = existing?.channelId ?? (channelId || channels[0]?.id);
    if (!cid) return;
    const base: Mark = existing ?? { id: uid(), channelId: cid, kind: k, cat, name: '', desc: '', location: draft.at, state: 'active', ...me, at: Date.now() };
    void save({
      ...base,
      cat: k === 'ping' ? 'general' : cat,
      name: (name.trim() || (k === 'ping' ? 'Ping' : k === 'objective' ? 'Objective' : MARK_CATEGORIES[cat])).slice(0, 60),
      desc: desc.trim(),
      ...(k === 'area' ? { radiusM: radius } : {}),
      ...(k === 'ping' ? { ttlS: PING_TTL_S } : {}),
      ...me,
      at: Date.now(),
    });
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal mark-modal" role="dialog" aria-label="Place mark">
        <div className="modal-head">
          <h2>
            <Icon name="pin" size={18} className="accent" /> {existing ? `Edit ${MARK_KIND_LABEL[k].toLowerCase()}` : 'New mark'}
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
              <p className="warn small-text">Marks are shared through a team channel (Team tab → Channels → New ntfy channel).</p>
            ) : (
              <>
                {!existing && (
                  <div className="seg mark-kinds">
                    {KINDS.map((x) => (
                      <button key={x} className={kind === x ? 'on' : ''} onClick={() => setKind(x)}>
                        {MARK_KIND_LABEL[x]}
                      </button>
                    ))}
                  </div>
                )}
                <p className="muted small-text">
                  {k === 'ping' && 'A quick "look here" that pulses on everyone’s map and disappears after 15 minutes.'}
                  {k === 'marker' && 'A point of interest everyone on the team can see until it’s cleared.'}
                  {k === 'area' && 'A circle of interest: a perimeter, a search area, a zone to avoid.'}
                  {k === 'objective' && 'A goal for the team, with a status: active, in progress, done.'}
                </p>
                {k !== 'ping' && (
                  <div className="field">
                    <span>Category</span>
                    <div className="chips">
                      {(Object.keys(MARK_CATEGORIES) as MarkCategory[]).map((c) => (
                        <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
                          <i className="mark-dot" style={{ background: k === 'objective' ? OBJECTIVE_COLOR : MARK_COLOR[c] }} /> {MARK_CATEGORIES[c]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="field">
                  <span>Name {k === 'ping' && '(optional)'}</span>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={k === 'ping' ? 'Look here' : k === 'objective' ? 'Secure the north lot' : 'Side gate, blue van, water main…'} />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 500))} placeholder={DESC_HINT} />
                </label>
                {k === 'area' && (
                  <label className="field">
                    <span>Radius · {radius < 1000 ? `${radius} m` : `${(radius / 1000).toFixed(1)} km`}</span>
                    <input type="range" min={25} max={3000} step={25} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
                  </label>
                )}
                {!existing && channels.length > 1 && (
                  <label className="field">
                    <span>Channel</span>
                    <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {existing?.kind === 'objective' && (
                  <label className="field">
                    <span>Status</span>
                    <select value={existing.state} onChange={(e) => void save({ ...existing, state: e.target.value as MarkState, ...me, at: Date.now() })}>
                      {(['active', 'progress', 'done'] as MarkState[]).map((st) => (
                        <option key={st} value={st}>
                          {MARK_STATE_LABEL[st]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {err && <p className="crit small-text">{err}</p>}
          </section>
        </div>
        <div className="modal-foot">
          <button className="btn small" onClick={existing ? () => setEditing(false) : close}>
            Cancel
          </button>
          <button className="btn small primary" disabled={!channels.length || busy || (k !== 'ping' && !name.trim() && !desc.trim())} onClick={submit}>
            <Icon name="pin" />
            {busy ? 'Sending…' : existing ? 'Save' : k === 'ping' ? 'Send ping' : `Place ${MARK_KIND_LABEL[k].toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Live marks for the Team view. */
export function MarkList() {
  const marks = useStore((s) => s.marks);
  const live = useMemo(() => marks.filter((m) => markLive(m)).sort((a, b) => b.at - a.at), [marks]);
  if (!live.length) return null;
  const counts = KINDS.map((k) => [k, live.filter((m) => m.kind === k).length] as const).filter(([, n]) => n);
  return (
    <div className="wp-list">
      <div className="tv-chat-head mono">MARKS · {counts.map(([k, n]) => `${n} ${MARK_KIND_LABEL[k].toUpperCase()}${n > 1 && k !== 'area' ? 'S' : ''}`).join(' · ')}</div>
      {live.slice(0, 12).map((m) => (
        <button key={m.id} className={`wp-row mark-row ${m.kind}`} onClick={() => openMark(m.id)} style={{ borderLeftColor: markColor(m) }}>
          <i className="mark-dot" style={{ background: markColor(m) }} />
          <b>{m.name}</b>
          <span className="muted small-text">
            {m.kind === 'objective' ? MARK_STATE_LABEL[m.state] : m.kind === 'ping' ? 'ping' : MARK_CATEGORIES[m.cat]} · {m.by} · {ageText(Date.now() - m.at)}
          </span>
        </button>
      ))}
    </div>
  );
}
