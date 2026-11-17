import { useMemo } from 'react';
import { setShared } from '../data/bus';
import { setState, useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { nearestCameras } from '../lib/traffic';
import { SOURCE_LABEL } from '../lib/signals';
import { CameraTile } from './Cameras';
import { fmtAgo, fmtTime } from './format';
import { LiveTv } from './NewsTab';
import { openExternal } from './popout';

const LEVEL_COLOR: Record<string, string> = { Stable: '#2BD47D', Guarded: '#9BE15D', Elevated: '#FFB020', High: '#FF7A45', Severe: '#FF4D4F' };

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
            stroke={k < lit ? color : 'rgba(143,163,184,.18)'}
            strokeWidth={k % 6 === 0 ? 2 : 1.4}
            filter={k < lit ? 'url(#glow)' : undefined}
          />
        );
      })}
      <text x="60" y="64" textAnchor="middle" className="gauge-num" fill={color}>
        {score}
      </text>
      <text x="60" y="80" textAnchor="middle" className="gauge-lvl" fill={color}>
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
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
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
    <Tile code="01" title="NEIGHBORHOOD STABILITY INDEX" led={s.score < 40 ? 'crit' : s.score < 70 ? 'warn' : 'ok'} right={`${pack.name.toUpperCase()} · NSI`} className="a-nsi">
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
        <button className="btn small" disabled={ai?.loading} onClick={() => (hasKey ? setShared({ requests: { ...requests, ai: Date.now() } }) : setState({ modal: 'settings' }))} title={hasKey ? 'Ask Claude for a briefing from the current data' : 'Add a Claude API key in Settings to enable AI briefings'}>
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
          <li key={k} className={`sev-${i.severity}`}>
            <span className="isrc">{i.source}</span>
            <span>{i.text}</span>
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
          <button key={n.id} className={`nt sev-${n.severity}`} onClick={() => void openExternal(n.url, n.source)}>
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
      {cams.length ? <div className="cam-wall">{cams.map((c) => <CameraTile key={c.id} cam={c} />)}</div> : <div className="empty">Loading cameras…</div>}
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
  const clusters = useStore((x) => x.clusters);
  const incidents = useStore((x) => x.incidents);
  const tz = useStore((x) => getPack(x.packId).timezone);
  return (
    <Tile code="06" title="ACTIVE SITUATIONS" led={clusters.length ? 'crit' : incidents.some((i) => i.severity >= 2) ? 'warn' : 'ok'} right={`${clusters.length + incidents.length} OPEN`} className="a-sit">
      <div className="sit-list">
        {clusters.map((c) => (
          <button key={c.id} className={`sit sev-${c.severity}`} onClick={() => setShared({ focus: { at: Date.now(), center: c.center, zoom: 14 } })}>
            <span className="tag crit">DEVELOPING</span> <b>{c.title}</b>
            <small>{c.sources.map((x) => SOURCE_LABEL[x]).join(' · ')} · {fmtTime(c.lastAt, tz)}</small>
          </button>
        ))}
        {incidents.slice(0, 20).map((i) => (
          <button key={i.id} className={`sit sev-${i.severity}`} onClick={() => i.location && setShared({ focus: { at: Date.now(), center: i.location } })}>
            <b>{i.title}</b>
            <small>{i.detail}</small>
          </button>
        ))}
        {!clusters.length && !incidents.length && <div className="empty">All quiet.</div>}
      </div>
    </Tile>
  );
}

function HoodsTile() {
  const s = useStore((x) => x.stability);
  const hoods = s?.neighborhoods ?? [];
  return (
    <Tile code="07" title="SECTOR RATINGS" right="7-DAY CRIME" className="a-hoods">
      {hoods.length ? (
        <table className="hoods">
          <tbody>
            {hoods.map((h) => (
              <tr key={h.name}>
                <td className="hn">{h.name}</td>
                <td>
                  <i className="bar">
                    <b style={{ width: `${h.score}%`, background: h.score < 40 ? '#FF7A45' : h.score < 70 ? '#FFB020' : '#2BD47D' }} />
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

function StatusTile() {
  const s = useStore((x) => x);
  const stat = (label: string, value: React.ReactNode, tone = '') => (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
  const helis = s.aircraft.filter((a) => a.kind === 'heli').length;
  const out = s.outages.reduce((n, o) => n + o.customers, 0);
  return (
    <Tile code="09" title="STATUS BOARD" className="a-status">
      <div className="stats-grid">
        {stat('Weather alerts', s.alerts.length, s.alerts.length ? 'warn' : '')}
        {stat('Air quality', s.air ? `${s.air.aqi}` : '—', (s.air?.aqi ?? 0) > 100 ? 'warn' : '')}
        {stat('Aircraft / helos', `${s.aircraft.length} / ${helis}`, Object.keys(s.orbiting).length ? 'warn' : '')}
        {stat('Circling now', Object.keys(s.orbiting).length, Object.keys(s.orbiting).length ? 'warn' : '')}
        {stat('Drones', s.drones.length)}
        {stat('Wildfires near', s.fires.filter((f) => f.severity >= 1).length)}
        {stat('Sat. heat (24h)', s.hotspots.length)}
        {stat('Quakes (7d)', s.quakes.length)}
        {stat('Rivers ≥ action', s.gauges.filter((g) => g.category !== 'no_flooding' && g.category !== 'unknown').length)}
        {stat('Power out', out.toLocaleString('en-US'), out >= 1000 ? 'warn' : '')}
        {stat('Transit issues', s.transit.filter((t) => t.severity >= 1).length)}
        {stat('Airport delays', s.airportDelays.length, s.airportDelays.length ? 'warn' : '')}
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
  const kpi = (label: string, value: React.ReactNode, tone = '') => (
    <div className={`kpi ${tone}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
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
        {kpi('VIOLENT · 48H', violent48, violent48 > (s?.violentDailyAvg ?? 0) * 2.5 ? 'warn' : '')}
        {kpi('OPEN SITUATIONS', incidents, incidents ? 'warn' : '')}
        {kpi('HELOS AIRBORNE', helis, helis ? 'warn' : '')}
        {kpi('AIR QUALITY', aqi ?? '—', (aqi ?? 0) > 100 ? 'warn' : '')}
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
      <StabilityTile />
      <InsightsTile />
      <TvTile />
      <CamsTile />
      <NewsTile />
      <AlertsTile />
      <HoodsTile />
      <CrimeTrendTile />
      <StatusTile />
    </div>
  );
}

