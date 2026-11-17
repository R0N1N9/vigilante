import { useEffect, useMemo, useState } from 'react';
import { distanceM } from '../lib/geo';
import { CHECKIN_REQUEST, CHECKIN_TAG, type TeamMember } from '../lib/comms';
import { SHARE_LABEL, type ShareCategory } from '../lib/poscrypt';
import { postToChannel } from '../data/engine/comms';
import { PosterStrip } from './Posters';
import { openAgent } from './Agents';
import { getState } from '../data/store';
import { setShared } from '../data/bus';
import { setState, useStore } from '../data/store';
import { isEmbed } from '../lib/embed';
import { isWeb } from '../lib/http';
import { getPack } from '../lib/packs';
import { nearestCameras } from '../lib/traffic';
import { SOURCE_LABEL } from '../lib/signals';
import { CameraTile } from './Cameras';
import { fmtAgo, fmtTime } from './format';
import { LiveTv } from './NewsTab';
import { openExternal } from './popout';
import { MapView } from '../map/MapView';
import { AircraftCard } from './AircraftCard';
import { CameraViewer } from './Cameras';
import { CRIME_MAP_URL } from '../lib/insights';
import type { LonLat } from '../lib/geo';

/** Fly the locator (and any map window) to a spot, mark it, and open a related page if there is one. */
function locate(center: LonLat | null | undefined, zoom: number | undefined, label: string, opt: { url?: string; title?: string; hex?: string } = {}) {
  if (center) setShared({ focus: { at: Date.now(), center, zoom, label }, ...(opt.hex ? { selectedHex: opt.hex } : {}) });
  if (opt.url) void openExternal(opt.url, opt.title ?? label);
}

function LocatorTile() {
  const focus = useStore((x) => x.focus);
  return (
    <Tile code="00" title="TACTICAL LOCATOR" led={focus ? 'warn' : 'ok'} right={focus?.label ? `◎ ${focus.label.toUpperCase().slice(0, 40)}` : 'CLICK ANY ITEM TO LOCATE'} className="a-map">
      <div className="stage locator">
        <MapView />
        <AircraftCard />
        <CameraViewer />
      </div>
    </Tile>
  );
}

/** Theme-aware: follows the accent/alert/critical colors chosen in Settings → Appearance. */
const LEVEL_COLOR: Record<string, string> = { Stable: 'var(--ok)', Guarded: 'var(--guarded)', Elevated: 'var(--warn)', High: 'var(--serious)', Severe: 'var(--crit)' };

function Tile({ code, title, right, led = 'ok', className = '', children }: { code: string; title: string; right?: React.ReactNode; led?: 'ok' | 'warn' | 'crit' | 'idle'; className?: string; children: React.ReactNode }) {
  return (
    <section className={`tile ${className}`}>
      <header>
        <span className={`led led-${led}`} />
        <span className="tcode">{code}</span>
        <h3>{title}</h3>
        <span className="tright">{right}</span>
      </header>
      <div className="tile-body">{children}</div>
    </section>
  );
}

/** Ten-segment tactical meter. */
function Meter({ value }: { value: number }) {
  const on = Math.round(value / 10);
  return (
    <span className="meter">
      {Array.from({ length: 10 }, (_, k) => (
        <i key={k} className={k < on ? (k >= 6 ? 'hot' : k >= 3 ? 'mid' : 'on') : ''} />
      ))}
    </span>
  );
}

function Gauge({ score, color, level }: { score: number; color: string; level: string }) {
  // Ring gauge with 48 tick marks; lit ticks show the score.
  const ticks = 48;
  const lit = Math.round((score / 100) * ticks);
  return (
    <svg viewBox="0 0 120 120" className="gauge" aria-label={`Stability ${score} of 100, ${level}`}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="60" cy="60" r="41" fill="none" stroke="rgba(61,214,245,.08)" strokeWidth="1" />
      {Array.from({ length: ticks }, (_, k) => {
        const a = ((k / ticks) * 360 - 90) * (Math.PI / 180);
        const r1 = 47;
        const r2 = k % 6 === 0 ? 56 : 53;
        return (
          <line
            key={k}
            x1={60 + r1 * Math.cos(a)}
            y1={60 + r1 * Math.sin(a)}
            x2={60 + r2 * Math.cos(a)}
            y2={60 + r2 * Math.sin(a)}
            style={{ stroke: k < lit ? color : 'rgba(143,163,184,.18)' }}
            strokeWidth={k % 6 === 0 ? 2 : 1.4}
            filter={k < lit ? 'url(#glow)' : undefined}
          />
        );
      })}
      <text x="60" y="64" textAnchor="middle" className="gauge-num" style={{ fill: color }}>
        {score}
      </text>
      <text x="60" y="80" textAnchor="middle" className="gauge-lvl" style={{ fill: color }}>
        {level.toUpperCase()}
      </text>
    </svg>
  );
}

function Spark({ points, color }: { points: { t: number; score: number }[]; color: string }) {
  if (points.length < 2) return <div className="muted small-text">Trend builds over the next hour (sampled every 5 min).</div>;
  const w = 220;
  const h = 36;
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / Math.max(1, t1 - t0)) * w).toFixed(1)},${(h - (p.score / 100) * h).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <path d={`${d} L${w},${h} L0,${h} Z`} style={{ fill: color }} opacity="0.08" />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth="1.4" />
    </svg>
  );
}

function StabilityTile() {
  const s = useStore((x) => x.stability);
  const hist = useStore((x) => x.stabilityHistory);
  const pack = useStore((x) => getPack(x.packId));
  if (!s)
    return (
      <Tile code="01" title="STABILITY INDEX" led="idle" className="a-nsi">
        <div className="empty">Computing from live sources…</div>
      </Tile>
    );
  const color = LEVEL_COLOR[s.level];
  return (
    <Tile code="01" title="STABILITY INDEX" led={s.score < 40 ? 'crit' : s.score < 70 ? 'warn' : 'ok'} right={`${pack.name.toUpperCase()} · NSI`} className="a-nsi">
      <div className="nsi">
        <Gauge score={s.score} color={color} level={s.level} />
        <div className="nsi-comps">
          {s.components.map((c) => (
            <div key={c.key} className="comp" title={c.detail}>
              <span>{c.label}</span>
              <Meter value={c.risk} />
              <em>{c.risk}</em>
            </div>
          ))}
          <div className="comp-note">RISK BY FACTOR · 0–100</div>
        </div>
      </div>
      <div className="spark-wrap">
        <span>24H TREND</span>
        <Spark points={hist} color={color} />
      </div>
    </Tile>
  );
}

function InsightsTile() {
  const insights = useStore((x) => x.insights);
  const ai = useStore((x) => x.ai);
  const hasKey = useStore((x) => !!x.settings.keys.claude);
  const requests = useStore((x) => x.requests);
  return (
    <Tile
      code="02"
      title="ANALYST INSIGHTS"
      led={insights.some((i) => i.severity >= 2) ? 'warn' : 'ok'}
      className="a-ins"
      right={
        // Web: AI only with the visitor's own key (Settings); embeds have no Settings, so no button.
        (hasKey || !isWeb()) && !isEmbed() && <button className="btn small" disabled={ai?.loading} onClick={() => (hasKey ? setShared({ requests: { ...requests, ai: Date.now() } }) : setState({ modal: 'settings' }))} title={hasKey ? 'Ask Claude for a briefing from the current data' : 'Add a Claude API key in Settings to enable AI briefings'}>
          {ai?.loading ? 'Thinking…' : hasKey ? '✦ AI briefing' : '✦ Enable AI'}
        </button>
      }
    >
      {ai && (ai.text || ai.error) && (
        <div className={`ai ${ai.error ? 'err' : ''}`}>
          <div className="ai-head">✦ AI BRIEFING{ai.at ? ` · ${fmtAgo(ai.at).toUpperCase()} AGO` : ''} · CLAUDE</div>
          {ai.error ? <p>{ai.error}</p> : <pre>{ai.text}</pre>}
        </div>
      )}
      <ul className="insights">
        {insights.map((i, k) => (
          <li key={k} className={`sev-${i.severity}${i.at || i.url ? ' act' : ''}`} onClick={() => locate(i.at, i.zoom, i.label ?? i.source, { url: i.url, hex: i.hex })} title={i.at || i.url ? `${i.at ? 'Show on map' : ''}${i.at && i.url ? ' and ' : ''}${i.url ? 'open the source' : ''}` : undefined}>
            <span className="isrc">{i.source}</span>
            <span>{i.text}</span>
            {(i.at || i.url) && <span className="go">{i.at ? '◎' : ''}{i.url ? '↗' : ''}</span>}
          </li>
        ))}
      </ul>
      {!insights.length && <div className="empty">Insights appear once data loads (about 20 seconds).</div>}
    </Tile>
  );
}

function NewsTile() {
  const news = useStore((x) => x.news);
  const rows = useMemo(() => news.filter((n) => n.local).slice(0, 30), [news]);
  return (
    <Tile code="05" title="LOCAL NEWS FEED" led={rows.some((n) => n.severity >= 2) ? 'warn' : 'ok'} right={`${rows.length} STORIES`} className="a-news">
      <div className="news-ticker">
        {rows.map((n) => (
          <button key={n.id} className={`nt sev-${n.severity}`} onClick={() => locate(n.pin, n.precision === 'place' ? 14 : 11, n.areaName ?? n.source, { url: n.url, title: n.source })} title="Show on map and open the story">
            <span className="nt-t">{fmtAgo(n.published).toUpperCase()}</span>
            <span className="nt-b">
              <b>{n.title}</b>
              <small>
                {n.source.toUpperCase()}
                {n.areaName ? ` · ${n.precision === 'area' ? '≈' : ''}${n.areaName.toUpperCase()}` : ''}
              </small>
            </span>
          </button>
        ))}
        {!rows.length && <div className="empty">Loading local news…</div>}
      </div>
    </Tile>
  );
}

function CamsTile() {
  const traffic = useStore((x) => x.cameras);
  const webcams = useStore((x) => x.webcams);
  const pack = useStore((x) => getPack(x.packId));
  const focus = useStore((x) => x.focus);
  const cams = useMemo(() => nearestCameras([...traffic, ...webcams], focus?.center ?? pack.center, 4), [traffic, webcams, focus, pack]);
  return (
    <Tile code="04" title="CAMERA GRID" led={cams.length ? 'ok' : 'idle'} right={`${traffic.length + webcams.length} FEEDS`} className="a-cams">
      {cams.length ? <div className="cam-wall">{cams.map((c) => (
            <div key={c.id} onClickCapture={() => locate(c.location, 15, c.name)}>
              <CameraTile cam={c} />
            </div>
          ))}</div> : <div className="empty">Loading cameras…</div>}
    </Tile>
  );
}

function TvTile() {
  return (
    <Tile code="03" title="BROADCAST" className="a-tv">
      <LiveTv />
    </Tile>
  );
}

function AlertsTile() {
  const allHits = useStore((x) => x.hits);
  const hits = useMemo(() => allHits.filter((h) => !h.acked), [allHits]);
  const clusters = useStore((x) => x.clusters);
  const incidents = useStore((x) => x.incidents);
  const tz = useStore((x) => getPack(x.packId).timezone);
  return (
    <Tile code="06" title="ACTIVE SITUATIONS" led={clusters.length || hits.some((h) => h.severity >= 3) ? 'crit' : hits.length ? 'warn' : incidents.some((i) => i.severity >= 2) ? 'warn' : 'ok'} right={`${clusters.length + incidents.length + hits.length} OPEN`} className="a-sit">
      <div className="sit-list">
        {hits.map((h) => (
          <button key={h.id} className={`sit hit sev-${h.severity}`} onClick={() => locate(h.location, 14, h.monitorName, { url: h.url, hex: h.hex })}>
            <span className="tag">◉ {h.monitorName.toUpperCase()}</span> <b>{h.title}</b>
            <small>{h.detail}</small>
          </button>
        ))}
        {clusters.map((c) => (
          <button key={c.id} className={`sit sev-${c.severity}`} onClick={() => locate(c.center, 14, c.title, { url: c.signals.find((x) => x.url)?.url })}>
            <span className="tag crit">DEVELOPING</span> <b>{c.title}</b>
            <small>{c.sources.map((x) => SOURCE_LABEL[x]).join(' · ')} · {fmtTime(c.lastAt, tz)}</small>
          </button>
        ))}
        {incidents.slice(0, 20).map((i) => (
          <button key={i.id} className={`sit sev-${i.severity}`} onClick={() => locate(i.location, 13, i.title, { url: i.url, hex: i.hex })}>
            <b>{i.title}</b>
            <small>{i.detail}</small>
          </button>
        ))}
        {!clusters.length && !incidents.length && !hits.length && <div className="empty">All quiet.</div>}
      </div>
    </Tile>
  );
}

function HoodsTile() {
  const s = useStore((x) => x.stability);
  const crimeSrc = useStore((x) => getPack(x.packId).intel.crime);
  const hoods = s?.neighborhoods ?? [];
  return (
    <Tile code="07" title="SECTOR RATINGS" right="7-DAY CRIME" className="a-hoods">
      {hoods.length ? (
        <table className="hoods">
          <tbody>
            {hoods.map((h) => (
              <tr key={h.name} className="act" title="Show on map and open the police crime map" onClick={() => locate(h.center, 14, h.name, { url: crimeSrc ? CRIME_MAP_URL[crimeSrc] : undefined, title: 'Crime map' })}>
                <td className="hn">{h.name}</td>
                <td>
                  <i className="bar">
                    <b style={{ width: `${h.score}%`, background: h.score < 40 ? 'var(--serious)' : h.score < 70 ? 'var(--warn)' : 'var(--ok)' }} />
                  </i>
                </td>
                <td className="r">{h.score}</td>
                <td className="r muted">{h.crimes}</td>
                <td className="r crit">{h.violent || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">Neighborhood ratings need city crime data (Denver and Atlanta today).</div>
      )}
      <div className="legend-line">STABILITY · REPORTS · VIOLENT — relative to the busiest sector this week</div>
    </Tile>
  );
}

function CrimeTrendTile() {
  const crimes = useStore((x) => x.crimes);
  const tz = useStore((x) => getPack(x.packId).timezone);
  const days = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    const out: { label: string; all: number; violent: number }[] = [];
    for (let d = 6; d >= 0; d--) {
      const start = Date.now() - (d + 1) * 86_400_000;
      const end = Date.now() - d * 86_400_000;
      const inDay = crimes.filter((c) => c.at >= start && c.at < end);
      out.push({ label: fmt.format(end - 1), all: inDay.length, violent: inDay.filter((c) => c.severity >= 2).length });
    }
    return out;
  }, [crimes, tz]);
  const max = Math.max(1, ...days.map((d) => d.all));
  const cats = useMemo(() => Object.entries(crimes.reduce<Record<string, number>>((m, c) => ((m[c.category] = (m[c.category] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5), [crimes]);
  return (
    <Tile code="08" title="CRIME ACTIVITY · 7D" right="REPORTS LAG 1–2 DAYS" className="a-crime">
      <div className="days">
        {days.map((d) => (
          <div key={d.label} className="day">
            <i style={{ height: `${(d.all / max) * 100}%` }}>
              <b style={{ height: `${d.all ? (d.violent / d.all) * 100 : 0}%` }} />
            </i>
            <span className="mono">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="chips">{cats.map(([c, n]) => <span key={c} className="src-chip">{c} · {n}</span>)}</div>
    </Tile>
  );
}

const SRC_ICON: Record<string, string> = { phone: '▣', mesh: '◇', ntfy: '◆' };

const ACT_LABEL: Record<string, string> = { still: 'still', walking: 'walking', running: 'running', cycling: 'cycling', driving: 'driving' };

function memberKind(m: TeamMember) {
  if (m.source === 'mesh') return 'RADIO';
  if (m.source === 'ntfy') return 'SHARED SPOT';
  return m.app === 'vigil' ? 'VIGIL' : 'PHONE';
}

function TeamTile() {
  const team = useStore((x) => x.team);
  const channels = useStore((x) => x.channels);
  const pack = useStore((x) => getPack(x.packId));
  const [now, setNow] = useState(Date.now());
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const rows = [...team].sort((a, b) => Number(!!a.dark) - Number(!!b.dark) || b.at - a.at);
  const online = rows.filter((m) => !m.dark && now - m.at < 5 * 60_000).length;
  const age = (t: number) => {
    const s = Math.max(0, Math.round((Math.max(now, Date.now()) - t) / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
  };
  const ntfyChannels = channels.filter((c) => c.kind === 'ntfy' && c.enabled);
  const requestCheckin = () => {
    for (const c of ntfyChannels) postToChannel(c.id, `${CHECKIN_REQUEST} from ${getState().settings.team.callsign || 'the console'}`, { tags: [CHECKIN_TAG] });
    setAsked(Date.now());
  };
  return (
    <Tile
      code="10"
      title="TEAM"
      led={online ? 'ok' : 'idle'}
      right={
        <>
          {online} ONLINE
          {ntfyChannels.length > 0 && (
            <button className="btn small" onClick={requestCheckin} disabled={now - asked < 30_000} title="Ask every phone for a fresh position. Each phone answers only if its owner allows it.">
              {now - asked < 30_000 ? 'Requested' : '📍 Request check-in'}
            </button>
          )}
        </>
      }
      className="a-team"
    >
      {rows.length ? (
        <table className="roster">
          <tbody>
            {rows.map((m) => {
              const stale = now - m.at > 5 * 60_000;
              const ch = channels.find((c) => c.id === m.channelId);
              const extras = [m.activity && m.activity !== 'unknown' ? ACT_LABEL[m.activity] ?? m.activity : '', m.heartRate ? `♥ ${m.heartRate}` : '', m.env?.db != null ? `${Math.round(m.env.db)} dB` : ''].filter(Boolean).join(' · ');
              return (
                <tr key={m.id} className={`act ${stale ? 'stale' : ''} ${m.dark ? 'dark' : ''}`} onClick={() => openAgent(m.id)} title="Profile and telemetry">
                  <td className={`src ${m.source} ${m.app ?? ''}`}>{m.dark ? '◌' : SRC_ICON[m.source]}</td>
                  <td className="nm">
                    {m.name}
                    <small>
                      {memberKind(m)}
                      {ch ? ` · ${ch.name.toUpperCase()}` : ''}
                      {m.perm && !m.dark ? ` · SHARING ${m.perm.map((p) => SHARE_LABEL[p as ShareCategory] ?? p).join(', ').toUpperCase()}` : ''}
                    </small>
                  </td>
                  {m.dark ? (
                    <td className="r dark-tag" colSpan={3}>
                      DARK
                    </td>
                  ) : (
                    <>
                      <td className="r">{m.location ? fmtDistNm(distanceM(m.location, pack.center)) : 'no location'}</td>
                      <td className="r">{extras || (m.speedMs != null && m.speedMs > 0.5 ? `${Math.round(m.speedMs * 2.237)} mph` : m.accuracyM != null ? `±${m.accuracyM} m` : '')}</td>
                      <td className="r">{m.battery != null ? `${m.charging ? '⚡' : ''}${m.battery}%` : ''}</td>
                    </>
                  )}
                  <td className={`r ${stale || m.dark ? 'muted' : 'ok'}`}>{age(m.at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty">{channels.length ? 'No one is sharing yet. Send teammates the phone check-in QR from Team → Channels → Invite (works for phone browsers and the Vigil app).' : 'Create a team channel in the Team tab, then invite phones to check in.'}</div>
      )}
    </Tile>
  );
}

const fmtDistNm = (m: number) => (m < 1609 ? `${Math.round(m * 3.281).toLocaleString('en-US')} ft` : `${(m / 1609).toFixed(1)} mi`);

function PostersTile() {
  const n = useStore((x) => x.wanted.length);
  const missing = useStore((x) => x.wanted.filter((w) => w.kind === 'missing').length);
  return (
    <Tile code="11" title="WANTED & MISSING" led={missing ? 'warn' : n ? 'ok' : 'idle'} right={`${missing} MISSING · ${n} FBI POSTERS`} className="a-posters">
      <PosterStrip />
    </Tile>
  );
}

function StatusTile() {
  const s = useStore((x) => x);
  const pack = getPack(s.packId);
  const stat = (label: string, value: React.ReactNode, tone = '', go?: () => void) => (
    <button className={`stat ${tone}${go ? ' act' : ''}`} onClick={go} disabled={!go}>
      <span>{label}</span>
      <b>{value}</b>
    </button>
  );
  const heliList = s.aircraft.filter((a) => a.kind === 'heli');
  const helis = heliList.length;
  const out = s.outages.reduce((n, o) => n + o.customers, 0);
  const orbitHex = Object.keys(s.orbiting)[0];
  const nearFire = [...s.fires].filter((f) => f.severity >= 1).sort((a, b) => a.distNm - b.distNm)[0];
  const bigQuake = [...s.quakes].sort((a, b) => b.mag - a.mag)[0];
  const flood = s.gauges.find((g) => g.category !== 'no_flooding' && g.category !== 'unknown');
  const transit = s.transit.find((t) => t.severity >= 1 && t.location);
  const plane = heliList[0] ?? s.aircraft[0];
  const C = pack.center;
  const wx = `https://forecast.weather.gov/MapClick.php?lat=${C[1].toFixed(4)}&lon=${C[0].toFixed(4)}`;
  return (
    <Tile code="09" title="STATUS BOARD" className="a-status">
      <div className="stats-grid">
        {stat('Weather alerts', s.alerts.length, s.alerts.length ? 'warn' : '', () => locate(C, 9, 'NWS forecast area', { url: wx, title: 'NWS forecast' }))}
        {stat('Air quality', s.air ? `${s.air.aqi}` : '—', (s.air?.aqi ?? 0) > 100 ? 'warn' : '', () => locate(C, pack.zoom, 'Air quality', { url: 'https://www.airnow.gov/', title: 'AirNow' }))}
        {stat('Aircraft / helos', `${s.aircraft.length} / ${helis}`, Object.keys(s.orbiting).length ? 'warn' : '', plane ? () => locate([plane.lon, plane.lat], 12, plane.callsign || plane.hex, { hex: plane.hex, url: `https://globe.adsb.lol/?icao=${plane.hex}`, title: 'ADS-B' }) : undefined)}
        {stat('Circling now', Object.keys(s.orbiting).length, orbitHex ? 'warn' : '', orbitHex ? () => locate(s.orbiting[orbitHex].center, 13, 'Circling aircraft', { hex: orbitHex, url: `https://globe.adsb.lol/?icao=${orbitHex}`, title: 'ADS-B' }) : undefined)}
        {stat('Drones', s.drones.length, '', s.drones.find((d) => d.location) ? () => locate(s.drones.find((d) => d.location)!.location, 16, 'Drone') : undefined)}
        {stat('Wildfires near', s.fires.filter((f) => f.severity >= 1).length, '', nearFire ? () => locate(nearFire.location, 10, nearFire.name, { url: 'https://www.nifc.gov/fire-information/nfn', title: 'NIFC' }) : undefined)}
        {stat('Sat. heat (24h)', s.hotspots.length, '', () => locate(C, 8, 'Satellite heat', { url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${C[0].toFixed(3)},${C[1].toFixed(3)},9z`, title: 'NASA FIRMS' }))}
        {stat('Quakes (7d)', s.quakes.length, '', bigQuake ? () => locate(bigQuake.location, 8, `M${bigQuake.mag.toFixed(1)} earthquake`, { url: bigQuake.url, title: 'USGS' }) : undefined)}
        {stat('Rivers ≥ action', s.gauges.filter((g) => g.category !== 'no_flooding' && g.category !== 'unknown').length, '', flood ? () => locate(flood.location, 13, flood.name, { url: `https://water.noaa.gov/gauges/${flood.id}`, title: 'NOAA gauge' }) : undefined)}
        {stat('Power out', out.toLocaleString('en-US'), out >= 1000 ? 'warn' : '', pack.power.utilities[0] ? () => locate(C, 9, 'Power outages', { url: pack.power.utilities[0].url, title: pack.power.utilities[0].name }) : undefined)}
        {stat('Transit issues', s.transit.filter((t) => t.severity >= 1).length, '', transit ? () => locate(transit.location, 15, transit.title, { url: transit.url }) : undefined)}
        {stat('Airport delays', s.airportDelays.length, s.airportDelays.length ? 'warn' : '', () => locate(C, 9, 'Airports', { url: 'https://nasstatus.faa.gov/', title: 'FAA NAS status' }))}
      </div>
    </Tile>
  );
}

function SitrepBar() {
  const pack = useStore((x) => getPack(x.packId));
  const s = useStore((x) => x.stability);
  const crimes = useStore((x) => x.crimes);
  const incidents = useStore((x) => x.incidents.length + x.clusters.length);
  const aqi = useStore((x) => x.air?.aqi);
  const helis = useStore((x) => x.aircraft.filter((a) => a.kind === 'heli').length);
  const feeds = useStore((x) => x.feeds);
  const live = Object.values(feeds).filter((f) => f.status === 'live').length;
  const total = Object.values(feeds).length;
  const violent48 = useMemo(() => crimes.filter((c) => c.severity >= 2 && Date.now() - c.at < 2 * 86_400_000).length, [crimes]);
  const color = s ? LEVEL_COLOR[s.level] : 'var(--dim)';
  const lastViolent = useMemo(() => crimes.filter((c) => c.severity >= 2).sort((a, b) => b.at - a.at)[0], [crimes]);
  const firstSit = useStore((x) => x.clusters[0]?.center ?? x.incidents.find((i) => i.location)?.location ?? null);
  const heli = useStore((x) => x.aircraft.find((a) => a.kind === 'heli')?.hex);
  const heliAt = useStore((x) => {
    const a = x.aircraft.find((y) => y.kind === 'heli');
    return a ? `${a.lon},${a.lat}` : '';
  });
  const teamOnline = useStore((x) => x.team.filter((m) => !m.dark && Date.now() - m.at < 5 * 60_000).length);
  const teamFirst = useStore((x) => x.team.find((m) => m.location && !m.dark)?.location ?? null);
  const kpi = (label: string, value: React.ReactNode, tone = '', go?: () => void) => (
    <button className={`kpi ${tone}${go ? ' act' : ''}`} onClick={go} disabled={!go}>
      <b>{value}</b>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="sitrep">
      <div className="sr-id">
        <span className="sr-tag">SITREP</span>
        <b>{pack.name.toUpperCase()}</b>
        <span className="sr-coord">
          {Math.abs(pack.center[1]).toFixed(3)}°{pack.center[1] >= 0 ? 'N' : 'S'} {Math.abs(pack.center[0]).toFixed(3)}°{pack.center[0] >= 0 ? 'E' : 'W'} · R{pack.radiusNm}NM
        </span>
      </div>
      <div className="sr-threat" style={{ borderColor: color, color }}>
        <span>CONDITION</span>
        <b>{s ? s.level.toUpperCase() : '—'}</b>
        <em>{s ? `${s.score}/100` : ''}</em>
      </div>
      <div className="sr-kpis">
        {kpi('VIOLENT · 48H', violent48, violent48 > (s?.violentDailyAvg ?? 0) * 2.5 ? 'warn' : '', lastViolent ? () => locate(lastViolent.location, 15, `Latest: ${lastViolent.offense}`, { url: pack.intel.crime ? CRIME_MAP_URL[pack.intel.crime] : undefined, title: 'Crime map' }) : undefined)}
        {kpi('OPEN SITUATIONS', incidents, incidents ? 'warn' : '', firstSit ? () => locate(firstSit, 13, 'Open situation') : undefined)}
        {kpi('HELOS AIRBORNE', helis, helis ? 'warn' : '', heli ? () => locate(heliAt.split(',').map(Number) as LonLat, 12, 'Helicopter', { hex: heli }) : undefined)}
        {kpi('AIR QUALITY', aqi ?? '—', (aqi ?? 0) > 100 ? 'warn' : '', () => locate(pack.center, pack.zoom, 'Air quality', { url: 'https://www.airnow.gov/', title: 'AirNow' }))}
        {kpi('TEAM ONLINE', teamOnline, '', teamFirst ? () => locate(teamFirst, 14, 'Team') : undefined)}
        {kpi('FEEDS LIVE', `${live}/${total}`)}
      </div>
    </div>
  );
}

/** World Monitor-style dashboard: every live source at a glance. */
export function Dashboard() {
  return (
    <div className="dashboard">
      <SitrepBar />
      <LocatorTile />
      <StabilityTile />
      <InsightsTile />
      <TvTile />
      <CamsTile />
      <NewsTile />
      <AlertsTile />
      <HoodsTile />
      <CrimeTrendTile />
      <TeamTile />
      <PostersTile />
      <StatusTile />
    </div>
  );
}

