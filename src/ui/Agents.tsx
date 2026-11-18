import { openDeploy } from './Deploy';
import { deviceOf } from '../lib/waypoints';
import { AgentIntel, Avatar, intelSummary, TeamIntel, useAgentIntel } from './Intel';
import { describeDevice, describeListening } from '../lib/teamext';
import { RadioPanel } from './Voice';
import { useEffect, useMemo, useState } from 'react';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { postToChannel } from '../data/engine/comms';
import { CHECKIN_REQUEST, CHECKIN_TAG, type TeamMember } from '../lib/comms';
import { distanceM, type LonLat } from '../lib/geo';
import { getPack } from '../lib/packs';
import { SHARE_LABEL, type ShareCategory } from '../lib/poscrypt';
import { agentStatus, ageText, STATUS_LABEL, teamBounds, type AgentStatus } from '../lib/team';
import { openSystem } from './popout';
import { shareToTeam } from './TeamTab';
import { placeWaypoint, WaypointList } from './Waypoints';
import { MarkList, newMarkAt } from './Marks';
import { Icon, RichText } from './Icon';

const useNow = (ms = 10_000) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
};

const fmtDist = (m: number) => (m < 1609 ? `${Math.round(m * 3.281).toLocaleString('en-US')} ft` : `${(m / 1609).toFixed(1)} mi`);
const kindOf = (m: TeamMember) => (m.source === 'mesh' ? 'RADIO' : m.source === 'ntfy' ? 'SHARED SPOT' : m.app === 'vigil' ? 'VIGIL' : 'PHONE');

/** Fit the map to every placed agent and pulse their markers. */
export function highlightTeam() {
  const s = getState();
  const placed = s.team.filter((m) => m.location && !m.dark).map((m) => m.location as LonLat);
  const b = teamBounds(placed);
  if (b) setShared({ focus: { at: Date.now(), center: placed[0], bounds: b, label: 'Team' } });
  setState({ teamHighlight: Date.now(), ...(s.mainView === 'dashboard' || s.mainView === 'team' ? {} : { mainView: 'map' }) });
}

export const openAgent = (id: string) => setState({ modal: 'agent', agentId: id });

/** Top bar: agents online / total. Click to show them all on the map. */
export function AgentsChip() {
  const team = useStore((s) => s.team);
  const now = useNow();
  const total = team.length;
  const online = team.filter((m) => agentStatus(m, now) === 'online').length;
  return (
    <button className={`agents-chip mono ${online ? 'on' : ''}`} onClick={highlightTeam} title={total ? `${online} of ${total} agents online. Click to show them all on the map.` : 'No agents yet. Invite phones from Team → Channels → Invite.'}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" />
      </svg>
      <b>{online}</b>
      <span>/{total}</span>
    </button>
  );
}

/** The Team view button, with the team counter (online / total) beside the word. Also flashes the team on the map. */
export function TeamViewButton({ on }: { on: boolean }) {
  const team = useStore((s) => s.team);
  const now = useNow();
  const total = team.length;
  const online = team.filter((m) => agentStatus(m, now) === 'online').length;
  return (
    <button
      className={`team-btn ${on ? 'on' : ''}`}
      onClick={() => {
        setState({ mainView: 'team' });
        if (total) highlightTeam();
      }}
      title={total ? `Team: ${online} of ${total} agents online` : 'Team: no agents yet. Use Deploy to add field agents.'}
    >
      Team
      <span className={`team-count ${online ? 'on' : ''}`}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" />
        </svg>
        {online}
        <i>/{total}</i>
      </span>
    </button>
  );
}

/** Top bar: ONLINE light. Green = connected and data flowing; amber = connected but sources failing; red = offline. */
export function OnlineIndicator() {
  const feeds = useStore((s) => s.feeds);
  const [net, setNet] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const now = useNow(15_000);
  useEffect(() => {
    const on = () => setNet(true);
    const off = () => setNet(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const vals = Object.values(feeds);
  const fresh = vals.some((f) => f.status === 'live' && now - f.at < 10 * 60_000);
  const failing = vals.filter((f) => f.status === 'error').length;
  const state = !net ? 'offline' : fresh || !failing ? 'online' : 'degraded';
  const label = state === 'online' ? 'ONLINE' : state === 'degraded' ? 'DEGRADED' : 'OFFLINE';
  const tip = state === 'online' ? 'Connected; live data is flowing.' : state === 'degraded' ? `Connected, but ${failing} data sources are failing.` : 'No network connection. Showing the last data received.';
  return (
    <span className={`online-ind ${state}`} title={tip} role="status" aria-live="polite">
      <i />
      {label}
    </span>
  );
}

function Metric({ k, v }: { k: string; v: React.ReactNode }) {
  return v === '' || v == null ? null : (
    <div className="metric">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function telemetry(m: TeamMember, center: LonLat) {
  return {
    distance: m.location ? fmtDist(distanceM(m.location, center)) : '',
    accuracy: m.accuracyM != null ? `±${m.accuracyM} m` : '',
    speed: m.speedMs != null ? `${Math.round(m.speedMs * 2.237)} mph` : '',
    heading: m.heading != null ? `${m.heading}°` : '',
    battery: m.battery != null ? `${m.battery}%${m.charging ? ' · charging' : ''}` : '',
    activity: m.activity && m.activity !== 'unknown' ? m.activity : '',
    heart: m.heartRate ? `${m.heartRate} bpm` : '',
    light: m.env?.lux != null ? `${Math.round(m.env.lux)} lux` : '',
    pressure: m.env?.hpa != null ? `${m.env.hpa.toFixed(0)} hPa` : '',
    noise: m.env?.db != null ? `${Math.round(m.env.db)} dB` : '',
  };
}

export function AgentCard({ m, now }: { m: TeamMember; now: number }) {
  const pack = useStore((s) => getPack(s.packId));
  const ch = useStore((s) => s.channels.find((c) => c.id === m.channelId));
  const st = agentStatus(m, now);
  const t = telemetry(m, pack.center);
  const intel = intelSummary(useAgentIntel(m));
  const listening = describeListening(m.radio);
  return (
    <button className={`agent-card ${st}`} onClick={() => openAgent(m.id)}>
      <div className="ac-top">
        <i className={`led-dot ${st}`} />
        {m.source === 'phone' && <Avatar id={deviceOf(m.id) ?? m.id} name={m.name} size={20} />}
        <b>{m.name}</b>
        <span className="ac-kind">{kindOf(m)}</span>
      </div>
      {m.source === 'phone' && <div className="ac-line">{describeDevice(m.device, m.app)}</div>}
      {listening && (
        <div className="ac-line listening">
          <Icon name="radio" size={11} /> {listening}
        </div>
      )}
      <div className="ac-sub">
        {[m.profile?.role, m.profile?.unit, ch?.name].filter(Boolean).join(' · ') || '—'}
      </div>
      {intel && <div className="ac-line intel mono">INTEL · {intel}</div>}
      {st === 'dark' ? (
        <div className="ac-dark">Went dark {ageText(now - m.at)} ago · no location kept</div>
      ) : (
        <div className="ac-metrics">
          <Metric k="Seen" v={`${ageText(now - m.at)} ago`} />
          <Metric k="Distance" v={t.distance || 'no location'} />
          <Metric k="Battery" v={t.battery} />
          <Metric k={t.activity ? 'Activity' : 'Speed'} v={t.activity || t.speed} />
          <Metric k="Heart" v={t.heart} />
        </div>
      )}
    </button>
  );
}

/** Profile and telemetry for one agent. */
export function AgentModal() {
  const m = useStore((s) => s.team.find((x) => x.id === s.agentId));
  const ch = useStore((s) => s.channels.find((c) => c.id === m?.channelId));
  const pack = useStore((s) => getPack(s.packId));
  const now = useNow(5_000);
  if (!m) return null;
  const close = () => setState({ modal: null, agentId: null });
  const st: AgentStatus = agentStatus(m, now);
  const t = telemetry(m, pack.center);
  const shared = (m.perm ?? []).map((p) => SHARE_LABEL[p as ShareCategory] ?? p);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide agent-modal" role="dialog" aria-label={`Agent ${m.name}`}>
        <div className="modal-head">
          <h2>
            <i className={`led-dot ${st}`} /> {m.name} <span className={`agent-status ${st}`}>{STATUS_LABEL[st]}</span>
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section className="agent-head">
            <div className="facts">
              <div className="fact">
                <span>Role</span>
                <b>{m.profile?.role || '—'}</b>
              </div>
              <div className="fact">
                <span>Unit</span>
                <b>{m.profile?.unit || '—'}</b>
              </div>
              <div className="fact">
                <span>Device</span>
                <b>{m.source === 'phone' ? describeDevice(m.device, m.app) : kindOf(m)}</b>
              </div>
              {m.radio && (
                <div className="fact">
                  <span>Listening to</span>
                  <b>{describeListening(m.radio)}</b>
                </div>
              )}
              <div className="fact">
                <span>Channel</span>
                <b>{ch?.name ?? (m.source === 'mesh' ? 'Meshtastic mesh' : '—')}</b>
              </div>
              <div className="fact">
                <span>Last report</span>
                <b>{ageText(now - m.at)} ago</b>
              </div>
              <div className="fact">
                <span>Sharing</span>
                <b>{st === 'dark' ? 'nothing (dark)' : shared.join(', ') || 'location'}</b>
              </div>
            </div>
            {(m.profile?.phone || m.profile?.email) && st !== 'dark' && (
              <div className="contact-row">
                {m.profile?.phone && (
                  <>
                    <button className="btn small" onClick={() => void openSystem(`tel:${m.profile!.phone!.replace(/[^+0-9]/g, '')}`)}>
                      <Icon name="phone" />Call {m.profile.phone}
                    </button>
                    <button className="btn small" onClick={() => void openSystem(`sms:${m.profile!.phone!.replace(/[^+0-9]/g, '')}`)}>
                      Text
                    </button>
                  </>
                )}
                {m.profile?.email && (
                  <button className="btn small" onClick={() => void openSystem(`mailto:${m.profile!.email}`)}>
                    <Icon name="mail" />{m.profile.email}
                  </button>
                )}
              </div>
            )}
            {!m.profile && st !== 'dark' && <p className="muted small-text">No contact details shared. People choose whether to share them from their phone.</p>}
          </section>
          {m.source === 'phone' && (
            <section>
              <h3 className="mono small-text muted">INTEL</h3>
              <AgentIntel m={m} />
            </section>
          )}
          {st === 'dark' ? (
            <section>
              <p>
                {m.name} went dark {ageText(now - m.at)} ago. Their location and trail were cleared from this console, and nothing more is sent until they turn sharing back on.
              </p>
            </section>
          ) : (
            <section>
              <h3>Telemetry</h3>
              <div className="metrics-grid">
                <Metric k="Position" v={m.location ? `${m.location[1].toFixed(5)}, ${m.location[0].toFixed(5)}` : 'not shared'} />
                <Metric k={`From ${pack.name}`} v={t.distance} />
                <Metric k="Accuracy" v={t.accuracy} />
                <Metric k="Speed" v={t.speed} />
                <Metric k="Heading" v={t.heading} />
                <Metric k="Trail" v={m.trail && m.trail.length > 1 ? `${m.trail.length} points` : ''} />
                <Metric k="Battery" v={t.battery} />
                <Metric k="Activity" v={t.activity} />
                <Metric k="Heart rate" v={t.heart} />
                <Metric k="Light" v={t.light} />
                <Metric k="Pressure" v={t.pressure} />
                <Metric k="Noise" v={t.noise} />
              </div>
            </section>
          )}
        </div>
        <div className="modal-foot">
          {m.location && st !== 'dark' && (
            <button
              className="btn small"
              onClick={() => {
                setShared({ focus: { at: Date.now(), center: m.location!, zoom: 16, label: m.name } });
                close();
              }}
            >
              <Icon name="target" />Show on map
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              shareToTeam(`@${m.name} `);
              close();
            }}
          >
            Message
          </button>
          {ch?.kind === 'ntfy' && (
            <button className="btn small primary" onClick={() => postToChannel(ch.id, `${CHECKIN_REQUEST} for ${m.name} from ${getState().settings.team.callsign || 'the console'}`, { tags: [CHECKIN_TAG] })}>
              <Icon name="pin" className="crit" />Request check-in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Team view: map, every agent's card, SOS alerts and recent chat. */
export function TeamView({ map }: { map: React.ReactNode }) {
  const team = useStore((s) => s.team);
  const channels = useStore((s) => s.channels);
  const hits = useStore((s) => s.hits);
  const chat = useStore((s) => s.chat);
  const now = useNow();
  const [filter, setFilter] = useState<'all' | AgentStatus>('all');
  const counts = useMemo(() => {
    const c: Record<AgentStatus, number> = { online: 0, stale: 0, offline: 0, dark: 0 };
    team.forEach((m) => c[agentStatus(m, now)]++);
    return c;
  }, [team, now]);
  const order: Record<AgentStatus, number> = { online: 0, stale: 1, offline: 2, dark: 3 };
  const rows = useMemo(() => team.filter((m) => filter === 'all' || agentStatus(m, now) === filter).sort((a, b) => order[agentStatus(a, now)] - order[agentStatus(b, now)] || a.name.localeCompare(b.name)), [team, filter, now]);
  const alerts = hits.filter((h) => h.monitorId === 'team-field' && !h.acked);
  const ntfy = channels.find((c) => c.kind === 'ntfy' && c.enabled);
  return (
    <div className="teamview">
      <div className="tv-head">
        <div className="tv-title">
          <span className="sr-tag">TEAM OPS</span>
          <b>{team.length} AGENTS</b>
        </div>
        <div className="tv-counts">
          {(['all', 'online', 'stale', 'offline', 'dark'] as const).map((k) => (
            <button key={k} className={`tv-count ${k} ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {k !== 'all' && <i className={`led-dot ${k}`} />}
              <b>{k === 'all' ? team.length : counts[k]}</b>
              <span>{k === 'all' ? 'ALL' : STATUS_LABEL[k]}</span>
            </button>
          ))}
        </div>
        <div className="tv-actions">
          <button className="btn small" onClick={() => newMarkAt(getState().focus?.center ?? getPack(getState().packId).center, 'marker')} title="Ping, marker, area of interest or objective. Tip: right-click the map to place one exactly.">
            <Icon name="target" />
            Add mark
          </button>
          <button className="btn small" onClick={() => placeWaypoint(getState().focus?.center ?? getPack(getState().packId).center)} title="Places at the selected spot (or the area center). Tip: right-click the map to place one exactly.">
            <Icon name="pin" />
            Place waypoint
          </button>
          <button className="btn small" onClick={highlightTeam} disabled={!team.some((m) => m.location && !m.dark)}>
            <Icon name="target" />Show all on map
          </button>
          {ntfy && (
            <button className="btn small" onClick={() => postToChannel(ntfy.id, `${CHECKIN_REQUEST} from ${getState().settings.team.callsign || 'the console'}`, { tags: [CHECKIN_TAG] })}>
              <Icon name="pin" className="crit" />Request check-in
            </button>
          )}
          <button className="btn small primary" onClick={openDeploy} title="QR code for phones to join as field agents">
            <Icon name="qr" /> Deploy field agents
          </button>
        </div>
      </div>
      <div className="tv-body">
        <div className="tv-map tile">{map}</div>
        <div className="tv-side">
          <RadioPanel />
          <WaypointList />
          <MarkList />
          <TeamIntel />
          {alerts.length > 0 && (
            <div className="tv-alerts">
              {alerts.map((h) => (
                <button key={h.id} className={`sit sev-${h.severity}`} onClick={() => h.location && setShared({ focus: { at: Date.now(), center: h.location, zoom: 16, label: h.title } })}>
                  <b><RichText text={h.title} /></b>
                  <small>{ageText(now - h.at)} ago · acknowledge in Alerts</small>
                </button>
              ))}
            </div>
          )}
          <div className="tv-cards">
            {rows.map((m) => (
              <AgentCard key={m.id} m={m} now={now} />
            ))}
            {!rows.length && <div className="empty">{team.length ? 'No agents in this state.' : 'No agents yet. Tap Deploy field agents and have them scan the QR code with their phone (iPhone or Android; or the Vigil app).'}</div>}
          </div>
          <div className="tv-chat">
            <div className="tv-chat-head mono">RECENT TEAM CHAT</div>
            {chat.slice(-6).map((c) => (
              <div key={c.id} className="tv-msg">
                <b>{c.mine ? 'You' : c.from}</b> <RichText text={c.text} />
              </div>
            ))}
            {!chat.length && <div className="muted small-text">No messages yet.</div>}
            <button className="btn small" onClick={() => setState({ tab: 'team' })}>
              Open team chat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
