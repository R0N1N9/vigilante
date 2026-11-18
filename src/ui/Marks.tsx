import { useMemo, useState } from 'react';
import { getState, setState, useStore } from '../data/store';
import { sendMark } from '../data/engine/comms';
import { ageText } from '../lib/team';
import { directionsLinks, hasStatus, markLive, markStateLabel, MARK_CATEGORIES, MARK_KIND_LABEL, PING_TTL_S, type Mark, type MarkCategory, type MarkKind, type MarkState } from '../lib/waypoints';
import { Icon } from './Icon';
import { MarkPhotos } from './Photos';
import { isReconName, reconName, RECON_NOTE } from '../lib/teamext';
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
export const INVESTIGATE_COLOR = '#A78BFA';
const KIND_COLOR: Partial<Record<MarkKind, string>> = { ping: PING_COLOR, objective: OBJECTIVE_COLOR, investigate: INVESTIGATE_COLOR };
export const markColor = (m: Pick<Mark, 'kind' | 'cat'>) => KIND_COLOR[m.kind] ?? MARK_COLOR[m.cat] ?? '#E6EDF3';

export const newMarkAt = (at: [number, number], kind: MarkKind) => setState({ modal: 'mark', markDraft: { at, kind } });
/** Ask the team for eyes and photos on a spot: an investigate mark named "Recon: …" (Vigil badges it). */
export const newReconAt = (at: [number, number]) => setState({ modal: 'mark', markDraft: { at, kind: 'investigate', recon: true } });
export const openMark = (id: string) => {
  const m = getState().marks.find((x) => x.id === id);
  if (m) setState({ modal: 'mark', markDraft: { at: m.location, id } });
};

const KINDS: MarkKind[] = ['ping', 'marker', 'investigate', 'area', 'objective'];
const DEFAULT_NAME: Partial<Record<MarkKind, string>> = { ping: 'Ping', objective: 'Objective', investigate: 'Check this out' };
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
  const [resolving, setResolving] = useState(false);
  const [found, setFound] = useState(existing?.found ?? '');
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
              <span className="wp-state">{isReconName(existing.name) ? 'RECON' : MARK_KIND_LABEL[existing.kind].toUpperCase()}</span>
              {existing.kind !== 'ping' && <span className="wp-state">{MARK_CATEGORIES[existing.cat].toUpperCase()}</span>}
              <span className={`wp-state ${existing.state === 'done' ? 'done' : live ? 'active' : ''}`}>{live ? markStateLabel(existing.kind, existing.state).toUpperCase() : 'EXPIRED'}</span>
            </h2>
            <button className="x" onClick={close} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <section>
              {existing.desc ? <p className="mark-desc">{existing.desc}</p> : <p className="muted">No description.</p>}
              {existing.kind === 'investigate' && existing.state === 'progress' && <p className="small-text accent">{existing.by} is checking it.</p>}
              {isReconName(existing.name) && <p className="recon-note small-text">RECON · photos requested. Post what you see.</p>}
              <MarkPhotos markId={existing.id} at={existing.location} />
              {existing.found && (
                <p className="mark-found">
                  <b>Found:</b> {existing.found}
                </p>
              )}
              {resolving && (
                <label className="field">
                  <span>What did you find?</span>
                  <textarea autoFocus rows={3} value={found} onChange={(e) => setFound(e.target.value.slice(0, 500))} placeholder="Gate was left open, now locked. Nothing else out of place." />
                </label>
              )}
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
            {existing.kind === 'investigate' && existing.state === 'active' && !resolving && (
              <button className="btn small" disabled={busy} onClick={() => update({ state: 'progress' })} title="Let the team know you're going to look">
                I'll check it
              </button>
            )}
            {existing.kind === 'investigate' && existing.state !== 'done' && (
              <button className="btn small primary" disabled={busy} onClick={() => (resolving ? update({ state: 'done', found: found.trim() }) : setResolving(true))}>
                <Icon name="check" />
                {resolving ? 'Mark resolved' : 'Resolve…'}
              </button>
            )}
            {existing.kind === 'investigate' && existing.state === 'done' && (
              <button className="btn small" disabled={busy} onClick={() => update({ state: 'active', found: '' })} title="Needs another look">
                Reopen
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
  const recon = !existing && !!draft.recon && k === 'investigate';
  const submit = () => {
    const cid = existing?.channelId ?? (channelId || channels[0]?.id);
    if (!cid) return;
    const base: Mark = existing ?? { id: uid(), channelId: cid, kind: k, cat, name: '', desc: '', location: draft.at, state: 'active', ...me, at: Date.now() };
    void save({
      ...base,
      cat: k === 'ping' ? 'general' : recon ? 'observation' : cat,
      name: recon ? reconName(name) : (name.trim() || DEFAULT_NAME[k] || MARK_CATEGORIES[cat]).slice(0, 60),
      desc: desc.trim() || (recon ? RECON_NOTE : ''),
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
            <Icon name="pin" size={18} className="accent" /> {existing ? `Edit ${MARK_KIND_LABEL[k].toLowerCase()}` : recon ? 'Request recon' : 'New mark'}
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
                {!existing && !recon && (
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
                  {k === 'investigate' && 'A “?” on a place someone should go and look at. Whoever checks it marks it resolved and says what they found.'}
                </p>
                {recon && <p className="muted small-text">Ask the team to go and look, and post photos of what they see. Everyone sees it as a “?” to check.</p>}
                {k !== 'ping' && !recon && (
                  <div className="field">
                    <span>Category</span>
                    <div className="chips">
                      {(Object.keys(MARK_CATEGORIES) as MarkCategory[]).map((c) => (
                        <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
                          <i className="mark-dot" style={{ background: KIND_COLOR[k] ?? MARK_COLOR[c] }} /> {MARK_CATEGORIES[c]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="field">
                  <span>{recon ? 'What to look at' : <>Name {k === 'ping' && '(optional)'}</>}</span>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={k === 'ping' ? 'Look here' : k === 'objective' ? 'Secure the north lot' : k === 'investigate' ? 'Gate open after hours? Odd noise? Light on?' : 'Side gate, blue van, water main…'} />
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
                {existing && hasStatus(existing.kind) && (
                  <label className="field">
                    <span>Status</span>
                    <select value={existing.state} onChange={(e) => void save({ ...existing, state: e.target.value as MarkState, ...me, at: Date.now() })}>
                      {(['active', 'progress', 'done'] as MarkState[]).map((st) => (
                        <option key={st} value={st}>
                          {markStateLabel(existing.kind, st)}
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
            {busy ? 'Sending…' : existing ? 'Save' : recon ? 'Request recon' : k === 'ping' ? 'Send ping' : `Place ${MARK_KIND_LABEL[k].toLowerCase()}`}
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
      <div className="tv-chat-head mono">MARKS · {counts.map(([k, n]) => `${n} ${MARK_KIND_LABEL[k].toUpperCase()}${n > 1 && k !== 'area' && k !== 'investigate' ? 'S' : ''}`).join(' · ')}</div>
      {live.slice(0, 12).map((m) => (
        <button key={m.id} className={`wp-row mark-row ${m.kind}`} onClick={() => openMark(m.id)} style={{ borderLeftColor: markColor(m) }}>
          <i className="mark-dot" style={{ background: markColor(m) }} />
          <b>{m.name}</b>
          <span className="muted small-text">
            {hasStatus(m.kind) ? `${m.kind === 'investigate' ? 'Investigate · ' : ''}${markStateLabel(m.kind, m.state)}` : m.kind === 'ping' ? 'ping' : MARK_CATEGORIES[m.cat]} · {m.by} · {ageText(Date.now() - m.at)}
          </span>
        </button>
      ))}
    </div>
  );
}
