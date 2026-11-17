import { useState } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { isWeb } from '../lib/http';
import { getPack } from '../lib/packs';
import { KIND_LABEL, METRIC_LABEL, newMonitor, TEMPLATES, type Metric, type Monitor, type MonitorHit, type MonitorKind } from '../lib/monitors';
import { SOURCE_LABEL, type Severity, type SignalSource } from '../lib/signals';
import { fmtAgo } from './format';
import { openExternal } from './popout';

const SEV = ['Info', 'Low', 'Warning', 'Serious', 'Critical'];
const list = (t: string) => t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const saveMonitors = (monitors: Monitor[]) => setShared({ monitors });
const updateMonitor = (id: string, patch: Partial<Monitor>) => saveMonitors(getState().monitors.map((m) => (m.id === id ? { ...m, ...patch } : m)));

function summary(m: Monitor): string {
  switch (m.kind) {
    case 'keyword':
      return m.keywords.length ? m.keywords.slice(0, 5).join(', ') + (m.keywords.length > 5 ? ` +${m.keywords.length - 5}` : '') : 'No keywords yet';
    case 'proximity':
      return m.center ? `Within ${(m.radiusM / 1609).toFixed(m.radiusM < 1609 ? 2 : 1)} mi of ${m.center[1].toFixed(4)}, ${m.center[0].toFixed(4)}` : 'Set a point on the map';
    case 'aircraft':
      return m.aircraft.length ? m.aircraft.join(', ') : 'Watchlist is empty';
    case 'threshold':
      return `${METRIC_LABEL[m.metric]} ${m.op} ${m.value.toLocaleString('en-US')}`;
  }
}

function Editor({ m }: { m: Monitor }) {
  const u = (patch: Partial<Monitor>) => updateMonitor(m.id, patch);
  const picking = useStore((s) => s.pickPoint === m.id);
  const focus = useStore((s) => s.focus);
  const pushReady = useStore((s) => !!s.settings.push.topic);
  const hookReady = useStore((s) => !!s.settings.notify.webhookUrl);
  const [kw, setKw] = useState(m.keywords.join(', '));
  const [ac, setAc] = useState(m.aircraft.join(', '));
  return (
    <div className="mon-editor">
      <label className="field">
        <span>Name</span>
        <input value={m.name} onChange={(e) => u({ name: e.target.value })} />
      </label>

      {m.kind === 'keyword' && (
        <label className="field">
          <span>Keywords or phrases (comma separated, whole words)</span>
          <textarea rows={3} value={kw} onChange={(e) => setKw(e.target.value)} onBlur={() => u({ keywords: list(kw) })} placeholder="shooting, Main St, Acme Corp" />
        </label>
      )}

      {m.kind === 'proximity' && (
        <>
          <div className="field-row">
            <button className={`btn small ${picking ? 'on' : ''}`} onClick={() => setState({ pickPoint: picking ? null : m.id, mainView: 'map' })}>
              {picking ? 'Click the map…' : '◎ Pick on map'}
            </button>
            <button className="btn small" disabled={!focus} onClick={() => focus && u({ center: focus.center })} title="Use the last spot you selected">
              Use selected spot
            </button>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Latitude, longitude</span>
              <input
                defaultValue={m.center ? `${m.center[1].toFixed(5)}, ${m.center[0].toFixed(5)}` : ''}
                key={m.center?.join(',')}
                placeholder="39.7392, -104.9903"
                onBlur={(e) => {
                  const p = e.target.value.split(',').map((x) => Number(x.trim()));
                  if (p.length === 2 && p.every((x) => Number.isFinite(x)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) u({ center: [p[1], p[0]] });
                }}
              />
            </label>
            <label className="field">
              <span>Radius (miles)</span>
              <input type="number" min={0.05} max={50} step={0.05} value={+(m.radiusM / 1609).toFixed(2)} onChange={(e) => u({ radiusM: Math.max(50, Number(e.target.value) * 1609) })} />
            </label>
          </div>
        </>
      )}

      {(m.kind === 'keyword' || m.kind === 'proximity') && (
        <>
          <div className="field">
            <span>Sources (none selected = all)</span>
            <div className="chips">
              {(Object.keys(SOURCE_LABEL) as SignalSource[]).map((src) => (
                <button key={src} className={`chip ${m.sources.includes(src) ? 'on' : ''}`} onClick={() => u({ sources: m.sources.includes(src) ? m.sources.filter((x) => x !== src) : [...m.sources, src] })}>
                  {SOURCE_LABEL[src]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Ignore reports below</span>
            <select value={m.minSeverity} onChange={(e) => u({ minSeverity: Number(e.target.value) as Severity })}>
              {SEV.map((l, i) => (
                <option key={i} value={i}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {m.kind === 'aircraft' && (
        <label className="field">
          <span>Watchlist: callsign or tail-number prefixes, ICAO hex codes, or type:AS50, type:heli, type:military, type:emergency</span>
          <textarea rows={3} value={ac} onChange={(e) => setAc(e.target.value)} onBlur={() => u({ aircraft: list(ac) })} placeholder="N911, type:heli, a1b2c3" />
        </label>
      )}

      {m.kind === 'threshold' && (
        <div className="field-row">
          <label className="field">
            <span>When</span>
            <select value={m.metric} onChange={(e) => u({ metric: e.target.value as Metric })}>
              {(Object.keys(METRIC_LABEL) as Metric[]).map((k) => (
                <option key={k} value={k}>
                  {METRIC_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>goes</span>
            <select value={m.op} onChange={(e) => u({ op: e.target.value as Monitor['op'] })}>
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
          </label>
          <label className="field">
            <span>value</span>
            <input type="number" value={m.value} onChange={(e) => u({ value: Number(e.target.value) })} />
          </label>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>Alert level</span>
          <select value={m.severity} onChange={(e) => u({ severity: Number(e.target.value) as Severity })}>
            {SEV.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Repeat no sooner than (min)</span>
          <input type="number" min={1} value={m.cooldownMin} onChange={(e) => u({ cooldownMin: Math.max(1, Number(e.target.value)) })} />
        </label>
        <label className="field">
          <span>Re-send until acked (min, 0 = off)</span>
          <input type="number" min={0} value={m.escalateMin} onChange={(e) => u({ escalateMin: Math.max(0, Number(e.target.value)) })} />
        </label>
      </div>
      <div className="field">
        <span>Notify by</span>
        <div className="chips">
          {(
            [
              ['desktop', 'Desktop'],
              ['sound', 'Sound'],
              ['phone', pushReady ? 'Phone (ntfy)' : 'Phone (set up in Settings)'],
              ['webhook', isWeb() ? 'Webhook (desktop app)' : hookReady ? 'Team webhook' : 'Webhook (set up in Settings)'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`chip ${m.actions[k] ? 'on' : ''}`} disabled={k === 'webhook' && isWeb()} title={k === 'webhook' && isWeb() ? 'Team webhooks need the desktop app' : undefined} onClick={() => u({ actions: { ...m.actions, [k]: !m.actions[k] } })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={m.breakQuiet} onChange={() => u({ breakQuiet: !m.breakQuiet })} /> Send even during quiet hours
      </label>
    </div>
  );
}

export function MonitorsPanel() {
  const monitors = useStore((s) => s.monitors);
  const hits = useStore((s) => s.hits);
  const [open, setOpen] = useState<string | null>(null);
  const add = (m: Monitor) => {
    if (m.kind === 'proximity') m.center = getState().focus?.center ?? getPack(getState().packId).center;
    saveMonitors([...getState().monitors, m]);
    setOpen(m.id);
  };
  return (
    <div className="monitors">
      <div className="callout">
        <b>Monitors</b>
        <p>Your own alert rules: keywords in any report, anything near a site, aircraft on a watchlist, or a number crossing a line. Hits land in the Alerts tab and can go to desktop, phone and your team chat.</p>
        <div className="field-row">
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v.startsWith('t:')) add(TEMPLATES[Number(v.slice(2))].make());
              else add(newMonitor(v as MonitorKind));
            }}
            aria-label="Add monitor"
          >
            <option value="">+ Add a monitor…</option>
            <optgroup label="Templates">
              {TEMPLATES.map((t, i) => (
                <option key={i} value={`t:${i}`}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Blank">
              {(Object.keys(KIND_LABEL) as MonitorKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>
      {monitors.map((m) => {
        const n = hits.filter((h) => h.monitorId === m.id && Date.now() - h.at < 86_400_000).length;
        return (
          <article key={m.id} className={`mon-row ${m.enabled ? '' : 'off'} ${open === m.id ? 'open' : ''}`}>
            <div className="mon-head">
              <label className="switch" title={m.enabled ? 'On' : 'Off'}>
                <input type="checkbox" checked={m.enabled} onChange={() => updateMonitor(m.id, { enabled: !m.enabled })} />
                <i />
              </label>
              <button className="mon-title" onClick={() => setOpen(open === m.id ? null : m.id)}>
                <b>{m.name}</b>
                <small>
                  {KIND_LABEL[m.kind].toUpperCase()} · {summary(m)}
                </small>
              </button>
              {n > 0 && <span className="badge">{n}</span>}
              <button className="x" title="Delete monitor" onClick={() => confirm(`Delete monitor "${m.name}"?`) && saveMonitors(getState().monitors.filter((x) => x.id !== m.id))}>
                ×
              </button>
            </div>
            {open === m.id && <Editor m={m} />}
          </article>
        );
      })}
      {!monitors.length && <div className="empty">No monitors yet. Start from a template above.</div>}
    </div>
  );
}

/** Monitor hits, newest first, with acknowledge. Shown at the top of the Alerts tab. */
export function HitsInbox() {
  const hits = useStore((s) => s.hits);
  const [showAcked, setShowAcked] = useState(false);
  const open = hits.filter((h) => !h.acked);
  const acked = hits.filter((h) => h.acked);
  if (!hits.length) return null;
  const ack = (ids: Set<string>) => setShared({ hits: getState().hits.map((h) => (ids.has(h.id) ? { ...h, acked: true } : h)) });
  const row = (h: MonitorHit) => (
    <article
      key={h.id}
      className={`incident hit sev-${h.severity} ${h.acked ? 'acked' : ''}`}
      onClick={() => {
        if (h.location) setShared({ focus: { at: Date.now(), center: h.location, zoom: 14, label: h.monitorName }, ...(h.hex ? { selectedHex: h.hex } : {}) });
      }}
    >
      <div className="inc-icon">◉</div>
      <div className="inc-body">
        <div className="inc-title">
          {h.title}
          <span className="mono muted">{fmtAgo(h.at)}</span>
        </div>
        <div className="inc-detail">
          <span className="tag">{h.monitorName}</span> {h.detail}
          {h.escalations > 0 && <span className="mono warn"> · re-sent {h.escalations}×</span>}
        </div>
        <div className="hit-actions">
          {!h.acked && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                ack(new Set([h.id]));
              }}
            >
              ✓ Acknowledge
            </button>
          )}
          {h.url && (
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                void openExternal(h.url!, h.monitorName);
              }}
            >
              Open source ↗
            </button>
          )}
        </div>
      </div>
    </article>
  );
  return (
    <div className="hits">
      <div className="hits-head">
        <span className="mono">MONITOR HITS · {open.length} OPEN</span>
        {open.length > 1 && (
          <button className="btn small" onClick={() => ack(new Set(open.map((h) => h.id)))}>
            Acknowledge all
          </button>
        )}
        {acked.length > 0 && (
          <button className="btn small" onClick={() => setShowAcked(!showAcked)}>
            {showAcked ? 'Hide' : 'Show'} history ({acked.length})
          </button>
        )}
      </div>
      {open.map(row)}
      {showAcked && acked.slice(0, 50).map(row)}
      {showAcked && acked.length > 0 && (
        <button className="btn small" onClick={() => confirm('Clear acknowledged history?') && setShared({ hits: getState().hits.filter((h) => !h.acked) })}>
          Clear history
        </button>
      )}
    </div>
  );
}
