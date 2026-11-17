import { useEffect, useState } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { isWeb } from '../lib/http';
import { getPack } from '../lib/packs';
import { randomTopic, type Settings } from '../lib/settings';
import { DEFAULT_APPEARANCE, hexToRgb, rgbToHex, THEMES, withTheme, type Appearance } from '../lib/theme';
import type { Severity } from '../lib/signals';
import { fmtTime } from './format';
import { AboutModal } from './AboutModal';

export function Modal({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setState({ modal: null });
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setState({ modal: null })}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={() => setState({ modal: null })} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const SEV_LABEL: Record<number, string> = { 1: 'Everything (info and up)', 2: 'Warnings and up', 3: 'Serious and up', 4: 'Critical only' };

function RgbField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const rgb = hexToRgb(value);
  const setPart = (i: number, v: string) => {
    const next = [...rgb] as [number, number, number];
    next[i] = Number(v) || 0;
    onChange(rgbToHex(...next));
  };
  return (
    <div className="rgb-field">
      <span>{label}</span>
      <input type="color" value={rgbToHex(...rgb)} onChange={(e) => onChange(e.target.value)} aria-label={`${label} color`} />
      {(['R', 'G', 'B'] as const).map((c, i) => (
        <label key={c} className="rgb-num">
          <em>{c}</em>
          <input type="number" min={0} max={255} value={rgb[i]} onChange={(e) => setPart(i, e.target.value)} />
        </label>
      ))}
      <code>{rgbToHex(...rgb).toUpperCase()}</code>
    </div>
  );
}

function AppearanceSection({ value: a, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  const custom = (patch: Partial<Appearance>) => onChange({ ...a, ...patch, theme: 'custom' });
  return (
    <section>
      <h3>Appearance</h3>
      <p className="muted small-text">Changes apply right away, in every window.</p>
      <div className="theme-grid">
        {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((id) => (
          <button key={id} className={`theme-swatch ${a.theme === id ? 'on' : ''}`} onClick={() => onChange(withTheme(a, id))} style={{ ['--sw' as string]: THEMES[id].accent, ['--swbg' as string]: THEMES[id].panel }}>
            <i />
            <b>{THEMES[id].label}</b>
            <small>{THEMES[id].note}</small>
          </button>
        ))}
        <button className={`theme-swatch ${a.theme === 'custom' ? 'on' : ''}`} onClick={() => onChange(withTheme(a, 'custom'))} style={{ ['--sw' as string]: a.accent, ['--swbg' as string]: a.panel }}>
          <i />
          <b>Custom</b>
          <small>Your RGB colors</small>
        </button>
      </div>
      <RgbField label="Accent" value={a.accent} onChange={(accent) => custom({ accent })} />
      <RgbField label="Panels" value={a.panel} onChange={(panel) => custom({ panel })} />
      <RgbField label="Background" value={a.bg} onChange={(bg) => custom({ bg })} />
      <label className="field range">
        <span>Panel opacity · {Math.round(a.panelOpacity * 100)}%</span>
        <input type="range" min={40} max={100} value={Math.round(a.panelOpacity * 100)} onChange={(e) => onChange({ ...a, panelOpacity: Number(e.target.value) / 100 })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={a.texture} onChange={(e) => onChange({ ...a, texture: e.target.checked })} /> Grid and scanline texture
      </label>
      <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(DEFAULT_APPEARANCE)}>
        Reset to default
      </button>
    </section>
  );
}

function SettingsModal() {
  const saved = useStore((s) => s.settings);
  const requests = useStore((s) => s.requests);
  const [s, setS] = useState<Settings>(saved);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = () => setShared({ settings: s });
  const set = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setS({ ...s, [k]: { ...s[k], ...v } });

  return (
    <Modal title="Settings">
      <AppearanceSection
        value={s.appearance}
        onChange={(appearance) => {
          setS({ ...s, appearance });
          setShared({ settings: { ...saved, appearance } });
        }}
      />
      <section>
        <h3>Optional keys</h3>
        <p className="muted small-text">Everything else works without keys. These have no keyless equivalent, so they're optional.</p>
        <label className="field">
          <span>Georgia 511 key (Atlanta road incidents + traffic cameras)</span>
          <input type="password" value={s.keys.ga511} onChange={(e) => set('keys', { ga511: e.target.value.trim() })} placeholder="from 511ga.org → Developers" />
        </label>
        <label className="field">
          <span>COtrip key (Denver road incidents)</span>
          <input type="password" value={s.keys.cotrip} onChange={(e) => set('keys', { cotrip: e.target.value.trim() })} placeholder="from manage-api.cotrip.org" />
        </label>
        <label className="field">
          <span>AISstream.io key (live ships, coastal areas only)</span>
          <input type="password" value={s.keys.ais} onChange={(e) => set('keys', { ais: e.target.value.trim() })} placeholder="from aisstream.io (sign in with GitHub)" />
        </label>
        <label className="field">
          <span>Claude API key (optional AI briefings on the Dashboard)</span>
          <input type="password" value={s.keys.claude} onChange={(e) => set('keys', { claude: e.target.value.trim() })} placeholder="from console.anthropic.com → API keys (pay per use)" />
        </label>
        {isWeb() ? (
          <p className="muted small-text">
            <b>Your keys stay in this browser</b> (local storage on this device). The Claude and AISstream keys go straight from your browser to Anthropic and AISstream. The 511 and COtrip
            keys travel inside the request URL through this site's data proxy, which doesn't store them. AI briefings send a summary of the dashboard data (no personal data) only
            when you press the button. Use the desktop app if you'd rather keep keys off the web entirely.
          </p>
        ) : (
          <p className="muted small-text">Keys are stored in a settings file on this computer. AI briefings send a summary of the dashboard data (no personal data) to Anthropic only when you press the button.</p>
        )}
      </section>

      <section>
        <h3>Phone alerts (ntfy, free)</h3>
        <p className="muted small-text">
          Install the free <b>ntfy</b> app (iOS/Android), tap “+”, and subscribe to the topic below. Anyone who knows the topic name can read it, so keep it long and random.
        </p>
        <label className="check">
          <input type="checkbox" checked={s.push.enabled} onChange={() => set('push', { enabled: !s.push.enabled, topic: s.push.topic || randomTopic() })} />
          Send alerts to my phone
        </label>
        <div className="field-row">
          <label className="field">
            <span>Topic</span>
            <input value={s.push.topic} onChange={(e) => set('push', { topic: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} />
          </label>
          <button className="btn small" onClick={() => set('push', { topic: randomTopic() })}>
            New
          </button>
        </div>
        <label className="field">
          <span>Server</span>
          <input value={s.push.server} onChange={(e) => set('push', { server: e.target.value.trim() })} />
        </label>
        <label className="field">
          <span>Send</span>
          <select value={s.push.minSeverity} onChange={(e) => set('push', { minSeverity: Number(e.target.value) as Severity })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {SEV_LABEL[n]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.push.onlyWatchAreas} onChange={() => set('push', { onlyWatchAreas: !s.push.onlyWatchAreas })} />
          Only for things inside my watch areas (weather and no-fly zones still come through)
        </label>
        <div className="field-row">
          <label className="field">
            <span>Quiet hours from</span>
            <input type="time" value={s.push.quietStart} onChange={(e) => set('push', { quietStart: e.target.value })} />
          </label>
          <label className="field">
            <span>to</span>
            <input type="time" value={s.push.quietEnd} onChange={(e) => set('push', { quietEnd: e.target.value })} />
          </label>
        </div>
        <p className="muted small-text">During quiet hours only critical alerts are sent.</p>
        <button className="btn small" disabled={!s.push.topic || dirty} onClick={() => setShared({ requests: { ...requests, pushTest: Date.now() } })} title={dirty ? 'Save first' : ''}>
          Send a test notification
        </button>
      </section>

      <section>
        <h3>Morning brief</h3>
        <label className="check">
          <input type="checkbox" checked={s.brief.enabled} onChange={() => set('brief', { enabled: !s.brief.enabled })} />
          Make a brief every day at
          <input type="time" className="inline" value={s.brief.time} onChange={(e) => set('brief', { time: e.target.value })} />
        </label>
        <label className="field">
          <span>Covering the previous</span>
          <select value={s.brief.hours} onChange={(e) => set('brief', { hours: Number(e.target.value) })}>
            {[8, 12, 16, 24].map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.brief.push} onChange={() => set('brief', { push: !s.brief.push })} />
          Also send it to my phone
        </label>
        <p className="muted small-text">The brief covers what the app saw while it was running, so leave it open overnight.</p>
      </section>

      <div className="modal-foot">
        <button className="btn" onClick={() => setState({ modal: null })}>
          Close
        </button>
        <button className="btn primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function BriefModal() {
  const brief = useStore((s) => s.brief);
  const pack = useStore((s) => getPack(s.packId));
  const requests = useStore((s) => s.requests);
  useEffect(() => {
    if (!getState().brief) setShared({ requests: { ...getState().requests, brief: Date.now() } });
  }, []);
  return (
    <Modal title={`${pack.name} brief`} wide>
      {!brief ? (
        <div className="empty">Building…</div>
      ) : (
        <div className="brief">
          <div className="brief-range mono muted">
            {fmtTime(brief.from, pack.timezone)} → {fmtTime(brief.to, pack.timezone)} · generated {fmtTime(brief.generatedAt, pack.timezone)}
          </div>
          <p className="brief-headline">{brief.headline}</p>
          {brief.sections.map((s) => (
            <section key={s.heading}>
              <h3>{s.heading}</h3>
              <ul>
                {s.items.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            </section>
          ))}
          {!brief.sections.length && <p className="muted">Nothing notable was recorded in this window. The brief only covers what the app saw while it was running.</p>}
        </div>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={() => setShared({ requests: { ...requests, brief: Date.now() } })}>
          Refresh
        </button>
        <button className="btn primary" onClick={() => setState({ modal: null })}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (modal === 'settings') return <SettingsModal />;
  if (modal === 'brief') return <BriefModal />;
  if (modal === 'about') return <AboutModal />;
  return null;
}
