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
import QRCode from 'qrcode';
import { fieldLink, inviteLink, MESHTASTIC_APP_URL, nativeLink, vigilLink } from '../lib/comms';
import { openSystem } from './popout';
import { PosterModal } from './Posters';
import { AgentModal } from './Agents';
import { WaypointModal } from './Waypoints';

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
          <button key={id} className={`theme-swatch ${a.theme === id ? 'on' : ''}`} onClick={() => onChange(withTheme(a, id))} style={{ ['--sw' as string]: THEMES[id].accent, ['--sw2' as string]: THEMES[id].alert, ['--swbg' as string]: THEMES[id].panel }}>
            <i />
            <b>{THEMES[id].label}</b>
            <small>{THEMES[id].note}</small>
          </button>
        ))}
        <button className={`theme-swatch ${a.theme === 'custom' ? 'on' : ''}`} onClick={() => onChange(withTheme(a, 'custom'))} style={{ ['--sw' as string]: a.accent, ['--sw2' as string]: a.alert, ['--swbg' as string]: a.panel }}>
          <i />
          <b>Custom</b>
          <small>Your RGB colors</small>
        </button>
      </div>
      <RgbField label="Accent" value={a.accent} onChange={(accent) => custom({ accent })} />
      <RgbField label="Panels" value={a.panel} onChange={(panel) => custom({ panel })} />
      <RgbField label="Background" value={a.bg} onChange={(bg) => custom({ bg })} />
      <RgbField label="Alerts" value={a.alert} onChange={(alert) => custom({ alert })} />
      <RgbField label="Critical" value={a.critical} onChange={(critical) => custom({ critical })} />
      <p className="muted small-text">Alerts color warnings and cautions; Critical colors emergencies and severe conditions. In-between levels blend the two. Map data layers keep their own colors so they match the legend.</p>
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
        <h3>Desktop and team alerts</h3>
        <p className="muted small-text">For every new report. Monitors (Watch tab) choose their own channels. Watch areas and quiet hours apply here too.</p>
        <div className="field-row">
          <label className="check">
            <input type="checkbox" checked={s.notify.desktop} onChange={() => set('notify', { desktop: !s.notify.desktop })} /> Desktop notifications
          </label>
          <label className="field">
            <span>for</span>
            <select value={s.notify.desktopMinSeverity} onChange={(e) => set('notify', { desktopMinSeverity: Number(e.target.value) as Severity })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {SEV_LABEL[n]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isWeb() && <p className="muted small-text"><b>Team webhooks need the desktop app.</b> Slack and Teams don't accept posts from web pages, and this site doesn't relay them.</p>}
        <fieldset className="plain" disabled={isWeb()}>
        <label className="field">
          <span>Team webhook URL (Slack, Discord, Microsoft Teams, or any https endpoint that takes JSON)</span>
          <input type="password" value={s.notify.webhookUrl} onChange={(e) => set('notify', { webhookUrl: e.target.value.trim() })} placeholder="https://hooks.slack.com/services/…" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Format</span>
            <select value={s.notify.webhookFormat} onChange={(e) => set('notify', { webhookFormat: e.target.value as Settings['notify']['webhookFormat'] })}>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="teams">Microsoft Teams</option>
              <option value="json">Plain JSON</option>
            </select>
          </label>
          <label className="field">
            <span>Send</span>
            <select value={s.notify.webhookMinSeverity} onChange={(e) => set('notify', { webhookMinSeverity: Number(e.target.value) as Severity })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {SEV_LABEL[n]}
                </option>
              ))}
            </select>
          </label>
        </div>
        </fieldset>
        <p className="muted small-text">The webhook URL works like a password: anyone with it can post to your channel. It's stored in the settings file on this computer.</p>
        <button className="btn small" disabled={dirty} onClick={() => setShared({ requests: { ...requests, notifyTest: Date.now() } })} title={dirty ? 'Save first' : ''}>
          Send a test ({isWeb() ? 'browser notification' : `desktop${s.notify.webhookUrl ? ' + webhook' : ''}`})
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

/** QR code drawn locally with the pinned qrcode package (no external QR service). */
export function Qr({ text, caption, size = 200 }: { text: string; caption: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(text, { margin: 2, width: 200, errorCorrectionLevel: text.length > 120 ? 'L' : 'M', color: { dark: '#000000', light: '#ffffff' } }).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <figure className="qr">
      {src ? <img src={src} alt={`QR code: ${caption}`} width={size} height={size} style={{ width: size, height: size }} /> : <div className="qr-wait" style={{ width: size, height: size }} />}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function InviteModal() {
  const ch = useStore((s) => s.channels.find((c) => c.id === s.inviteChannelId));
  const callsign = useStore((s) => s.settings.team.callsign);
  const [withToken, setWithToken] = useState(true);
  const [copied, setCopied] = useState('');
  if (!ch) return null;
  const link = inviteLink(ch, withToken);
  const native = nativeLink(ch);
  const field = ch.kind === 'ntfy' && ch.posKey ? fieldLink(ch, withToken) : null;
  const who = callsign ? `${callsign} invited you` : "You're invited";
  const body =
    ch.kind === 'ntfy'
      ? `${who} to the "${ch.name}" team channel on Vigilance.\n\n${field ? `On your phone (check in and share your location): ${field}\n\n` : ''}On a laptop with Vigilance: ${link}\n\nNo Vigilance? Follow along in the free ntfy app: ${native}${ch.token && withToken ? '' : ''}\n\nThis link works like a key: please don't forward it.`
      : `${who} to the "${ch.name}" Meshtastic channel.\n\n1. Open this link on your phone with the Meshtastic app installed so your radio joins the channel: ${native ?? '(ask for the channel link)'}\n2. Add it in Vigilance: ${link}\n\nGet the Meshtastic app: ${MESHTASTIC_APP_URL}\n\nThis link contains the channel key: please don't forward it.`;
  const copy = async (what: string, label: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      prompt('Copy this:', what);
    }
  };
  const subject = `Join "${ch.name}" on Vigilance`;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <Modal title={`Invite to ${ch.name}`} wide>
      <section>
        <p className="muted small-text">
          {ch.kind === 'ntfy'
            ? 'Teammates scan or open the Vigilance link to join. People without Vigilance can scan the ntfy code to read and reply from the free ntfy phone app.'
            : 'Teammates first scan the Meshtastic code with the Meshtastic app so their radio joins the encrypted channel, then add it in Vigilance with the other code.'}
        </p>
        {field && (
          <div className="field-invite">
            <Qr text={field} caption="Phones: check in + share location" />
            <div>
              <b>Phone check-in</b>
              <p className="small-text muted">Teammates scan this with their phone camera. It opens a page in their browser (nothing to install) where they can chat, send SOS or backup calls, and turn on live location sharing. Their position then shows on your map and dashboard. Locations are encrypted end to end with a key that only travels in this invite.</p>
              <div className="copy-row">
                <input readOnly value={field} onFocus={(e) => e.target.select()} />
                <button className="btn small" onClick={() => void copy(field, 'field')}>
                  {copied === 'field' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="small-text muted">
                <b>Vigil app:</b> scan the same code from inside Vigil, or tap “Open this team in Vigil” on the check-in page. Vigil lets each person choose what to share (location, battery, motion, heart rate, sensors) and go dark at any time.
              </p>
              <div className="copy-row">
                <input readOnly value={vigilLink(ch, withToken)} onFocus={(e) => e.target.select()} />
                <button className="btn small" onClick={() => void copy(vigilLink(ch, withToken), 'vigil')}>
                  {copied === 'vigil' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="qr-row">
          <Qr text={link} caption="Join in Vigilance (laptops)" />
          {native ? <Qr text={ch.kind === 'ntfy' ? native : native} caption={ch.kind === 'ntfy' ? 'ntfy app (no Vigilance needed)' : 'Meshtastic app: join the radio channel'} /> : <div className="qr-missing small-text muted">Paste the channel's share link from the Meshtastic app (Channels → Share) into this channel's settings to show its QR code here.</div>}
        </div>
        <label className="field">
          <span>Invite link</span>
          <div className="copy-row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn small" onClick={() => void copy(link, 'link')}>
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>
        {native && (
          <label className="field">
            <span>{ch.kind === 'ntfy' ? 'ntfy topic link' : 'Meshtastic channel link'}</span>
            <div className="copy-row">
              <input readOnly value={native} onFocus={(e) => e.target.select()} />
              <button className="btn small" onClick={() => void copy(native, 'native')}>
                {copied === 'native' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </label>
        )}
        {ch.kind === 'ntfy' && ch.token && (
          <label className="check small-text">
            <input type="checkbox" checked={withToken} onChange={() => setWithToken(!withToken)} /> Include the access token in the Vigilance link (otherwise send it separately)
          </label>
        )}
        <div className="field-row">
          <button className="btn small" onClick={() => void copy(body, 'msg')}>
            {copied === 'msg' ? 'Copied' : 'Copy invite message'}
          </button>
          <button className="btn small" onClick={() => void openSystem(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)}>
            Email
          </button>
          <button className="btn small" onClick={() => void openSystem(`sms:?&body=${encodeURIComponent(body)}`)}>
            Text message
          </button>
          {canShare && (
            <button className="btn small" onClick={() => void navigator.share({ title: subject, text: body }).catch(() => {})}>
              Share…
            </button>
          )}
        </div>
        <p className="muted small-text">Anyone with these links can join the channel. Send them only to people on your team, and make a new channel if one leaks.</p>
      </section>
    </Modal>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (modal === 'invite') return <InviteModal />;
  if (modal === 'poster') return <PosterModal />;
  if (modal === 'agent') return <AgentModal />;
  if (modal === 'waypoint') return <WaypointModal />;
  if (modal === 'settings') return <SettingsModal />;
  if (modal === 'brief') return <BriefModal />;
  if (modal === 'about') return <AboutModal />;
  return null;
}
