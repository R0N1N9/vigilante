import { SOCRATA_CRIME } from '../lib/crimeSources';
import type { Crime } from '../lib/intel';
import { useMemo, useState } from 'react';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { aqiLabel, gaugeSeverity, hourHistogram, quakeSeverity, shipTypeName, stormSeverity } from '../lib/intel';
import { getPack } from '../lib/packs';
import type { LonLat } from '../lib/geo';
import { fmtAgo } from './format';

const focus = (center: LonLat, zoom = 15) => setShared({ focus: { at: Date.now(), center, zoom } });

function Source({ children }: { children: React.ReactNode }) {
  return <div className="row-head"><span className="mono muted small-text">{children}</span></div>;
}

function FeedNote({ feed }: { feed: { status: string; error?: string } }) {
  if (feed.status === 'off' || feed.status === 'error') return <div className="empty">{feed.error ?? 'Unavailable'}</div>;
  if (feed.status === 'idle') return <div className="empty">Loading…</div>;
  return null;
}

// ------------------------------------------------------------------ Crime ---

export function CrimeList() {
  const crimes = useStore((s) => s.crimes);
  const feed = useStore((s) => s.feeds.crime);
  const pack = useStore((s) => getPack(s.packId));
  const [min, setMin] = useState(1);
  const rows = useMemo(() => crimes.filter((c) => c.severity >= min).slice(0, 200), [crimes, min]);
  const hist = useMemo(() => hourHistogram(crimes.filter((c) => c.severity >= 1), pack.timezone), [crimes, pack.timezone]);
  const max = Math.max(1, ...hist);
  if (!crimes.length) return <div className="list"><FeedNote feed={feed} />{feed.status === 'live' && <div className="empty">No offenses reported in the last 7 days.</div>}</div>;
  return (
    <div className="list">
      <Source>{crimeSourceLabel(pack.intel.crime, crimes)} · {crimes.length} offenses</Source>
      <div className="hist" title="Violent and property crime by hour of day (local)">
        {hist.map((n, h) => (
          <i key={h} style={{ height: `${(n / max) * 100}%` }} title={`${h}:00 · ${n}`} />
        ))}
      </div>
      <div className="hist-axis mono"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
      <div className="seg small" style={{ margin: '6px 0 8px' }}>
        {[[0, 'All'], [1, 'Property+'], [2, 'Violent'], [3, 'Shootings']].map(([v, l]) => (
          <button key={v} className={min === v ? 'on' : ''} onClick={() => setMin(v as number)}>{l}</button>
        ))}
      </div>
      {rows.map((c) => (
        <article key={c.id} className={`incident sev-${c.severity}`} onClick={() => focus(c.location)}>
          <div className="inc-body">
            <div className="inc-title">{c.offense}{c.firearm && <span className="tag crit">FIREARM</span>}<span className="mono muted">{fmtAgo(c.at)}</span></div>
            <div className="inc-detail">{c.address}{c.neighborhood ? ` · ${c.neighborhood}` : ''}</div>
          </div>
        </article>
      ))}
      <p className="muted small-text note">Locations are block-level as published by the police department. Neither city publishes live 911 calls openly; these are filed reports.</p>
    </div>
  );
}

// -------------------------------------------------------------------- 311 ---

export function Requests311() {
  const rows = useStore((s) => s.requests311);
  const feed = useStore((s) => s.feeds.s311);
  const byType = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(r.summary, (m.get(r.summary) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [rows]);
  if (!rows.length) return <div className="list"><FeedNote feed={feed} /></div>;
  return (
    <div className="list">
      <Source>Denver 311 · last 3 days · {rows.length} requests · turn on the 311 map layer to see dots</Source>
      <div className="chips" style={{ marginBottom: 8 }}>{byType.map(([t, n]) => <span key={t} className="src-chip">{t} · {n}</span>)}</div>
      {rows.slice(0, 150).map((r) => (
        <article key={r.id} className="incident sev-0" onClick={() => focus(r.location, 16)}>
          <div className="inc-body">
            <div className="inc-title">{r.summary}<span className="mono muted">{fmtAgo(r.at)}</span></div>
            <div className="inc-detail">{r.address} · {r.status}{r.neighborhood ? ` · ${r.neighborhood}` : ''}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- Wanted ---

// ---------------------------------------------------------------- Hazards ---

function Quakes() {
  const quakes = useStore((s) => s.quakes);
  const feed = useStore((s) => s.feeds.quakes);
  return (
    <div className="list">
      <Source>USGS earthquakes · past 7 days · within 300 km</Source>
      <FeedNote feed={feed} />
      {quakes.map((q) => (
        <article key={q.id} className={`incident sev-${quakeSeverity(q)}`} onClick={() => focus(q.location, 9)}>
          <div className="inc-body">
            <div className="inc-title">M{q.mag.toFixed(1)} · {q.place}<span className="mono muted">{fmtAgo(q.at)}</span></div>
            <div className="inc-detail">{Math.round(q.distKm)} km away · depth {q.depthKm.toFixed(0)} km</div>
          </div>
        </article>
      ))}
      {feed.status === 'live' && !quakes.length && <div className="empty">No earthquakes M1.5+ within 300 km this week.</div>}
    </div>
  );
}

function Floods() {
  const gauges = useStore((s) => s.gauges);
  const feed = useStore((s) => s.feeds.floods);
  const sorted = useMemo(() => [...gauges].sort((a, b) => gaugeSeverity(b) - gaugeSeverity(a)), [gauges]);
  return (
    <div className="list">
      <Source>NOAA river gauges · {gauges.length} in area · {gauges.filter((g) => gaugeSeverity(g) >= 1).length} at action stage or above</Source>
      <FeedNote feed={feed} />
      {sorted.slice(0, 60).map((g) => (
        <article key={g.id} className={`incident sev-${gaugeSeverity(g)}`} onClick={() => focus(g.location, 13)}>
          <div className="inc-body">
            <div className="inc-title">{g.name}<span className="mono muted">{g.stage != null ? `${g.stage} ${g.unit}` : '—'}</span></div>
            <div className="inc-detail">{g.category.replace('_', ' ')}{g.forecastCategory && g.forecastCategory !== 'no_flooding' ? ` · forecast ${g.forecastCategory}` : ''}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Air() {
  const air = useStore((s) => s.air);
  const feed = useStore((s) => s.feeds.air);
  if (!air) return <div className="list"><FeedNote feed={feed} /></div>;
  const color = air.aqi <= 50 ? '#2BD47D' : air.aqi <= 100 ? '#FFD84D' : air.aqi <= 150 ? '#FFB020' : air.aqi <= 200 ? '#FF4D4F' : '#C026D3';
  return (
    <div className="list">
      <Source>Open-Meteo air quality (CAMS model) · city center</Source>
      <div className="aqi" style={{ borderColor: color }}>
        <b style={{ color }}>{air.aqi}</b>
        <div><div className="inc-title">{aqiLabel(air.aqi)}</div><div className="muted small-text">US AQI · PM2.5 {air.pm25.toFixed(0)} µg/m³ · ozone {air.ozone.toFixed(0)} µg/m³</div></div>
      </div>
    </div>
  );
}

function Storms() {
  const storms = useStore((s) => s.storms);
  const feed = useStore((s) => s.feeds.storms);
  return (
    <div className="list">
      <Source>NWS local storm reports (spotters, emergency managers) · last 24 h</Source>
      <FeedNote feed={feed} />
      {storms.map((r) => (
        <article key={r.id} className={`incident sev-${stormSeverity(r)}`} onClick={() => focus(r.location, 12)}>
          <div className="inc-body">
            <div className="inc-title">{r.type}{r.magnitude ? ` · ${r.magnitude} ${r.unit}` : ''}<span className="mono muted">{fmtAgo(r.at)}</span></div>
            <div className="inc-detail">{r.city}{r.remark ? ` · ${r.remark}` : ''}</div>
          </div>
        </article>
      ))}
      {feed.status === 'live' && !storms.length && <div className="empty">No storm reports in the last 24 hours.</div>}
    </div>
  );
}

function Satellite() {
  const hotspots = useStore((s) => s.hotspots);
  const feed = useStore((s) => s.feeds.firms);
  return (
    <div className="list">
      <Source>NASA FIRMS (VIIRS + MODIS) · heat detections in last 24 h · within 75 nm</Source>
      <FeedNote feed={feed} />
      {[...hotspots].sort((a, b) => b.at - a.at).map((h) => (
        <article key={h.id} className="incident sev-1" onClick={() => focus(h.location, 12)}>
          <div className="inc-body">
            <div className="inc-title">{h.frp.toFixed(1)} MW heat signature<span className="mono muted">{fmtAgo(h.at)}</span></div>
            <div className="inc-detail">{h.satellite} · {h.day ? 'day' : 'night'} pass · confidence {h.confidence}</div>
          </div>
        </article>
      ))}
      {feed.status === 'live' && !hotspots.length && <div className="empty">No satellite heat detections nearby in the last 24 hours.</div>}
      <p className="muted small-text note">Satellites pass a few times a day. A detection can be a wildfire, a prescribed burn, or industrial heat.</p>
    </div>
  );
}

type HazardSection = 'storms' | 'quakes' | 'floods' | 'air' | 'satellite';

export function HazardsTab() {
  const [sec, setSec] = useState<HazardSection>('storms');
  const n = {
    storms: useStore((s) => s.storms.length),
    quakes: useStore((s) => s.quakes.length),
    floods: useStore((s) => s.gauges.filter((g) => gaugeSeverity(g) >= 1).length),
    air: 0,
    satellite: useStore((s) => s.hotspots.length),
  };
  const aqi = useStore((s) => s.air?.aqi);
  const label: Record<HazardSection, string> = { storms: 'Storms', quakes: 'Quakes', floods: 'Floods', air: `Air${aqi != null ? ` · ${aqi}` : ''}`, satellite: 'Satellite' };
  return (
    <>
      <div className="subtabs seg small">
        {(Object.keys(label) as HazardSection[]).map((k) => (
          <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{label[k]}{n[k] ? ` · ${n[k]}` : ''}</button>
        ))}
      </div>
      {sec === 'storms' ? <Storms /> : sec === 'quakes' ? <Quakes /> : sec === 'floods' ? <Floods /> : sec === 'air' ? <Air /> : <Satellite />}
    </>
  );
}

// ------------------------------------------------------- Ships & airports ---

export function ShipsList() {
  const ships = useStore((s) => s.ships);
  const feed = useStore((s) => s.feeds.ships);
  return (
    <div className="list">
      <Source>AIS via AISstream.io · {ships.length} vessels</Source>
      <FeedNote feed={feed} />
      {[...ships].sort((a, b) => b.at - a.at).map((v) => (
        <article key={v.mmsi} className="incident sev-0" onClick={() => focus(v.location, 13)}>
          <div className="inc-body">
            <div className="inc-title">{v.name || `MMSI ${v.mmsi}`}<span className="mono muted">{fmtAgo(v.at)}</span></div>
            <div className="inc-detail">{shipTypeName(v.type)}{v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ''}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function AirportStatus() {
  const delays = useStore((s) => s.airportDelays);
  const feed = useStore((s) => s.feeds.airports);
  const pack = useStore((s) => getPack(s.packId));
  if (!pack.intel.airports.length) return null;
  return (
    <div className="airports">
      <span className="mono muted small-text">FAA · {pack.intel.airports.join(' ')}</span>
      {feed.status === 'live' && !delays.length && <span className="ok small-text">No delays or ground stops</span>}
      {delays.map((d) => (
        <div key={`${d.airport}${d.kind}`} className="warn small-text">
          <b>{d.airport}</b> {d.kind}: {d.reason} {d.detail && `(${d.detail})`}
        </div>
      ))}
    </div>
  );
}

/** Which police feed this is, its window, and how far behind it runs. */
function crimeSourceLabel(id: string | null, crimes: Crime[]) {
  if (id === 'denver') return 'Denver Police (NIBRS) open data · last 7 days · reports lag 1–2 days';
  if (id === 'atlanta') return 'Atlanta Police open data · last 7 days · reports lag 1–2 days';
  const s = id ? SOCRATA_CRIME[id] : undefined;
  if (!s) return 'Police open data';
  const newest = crimes.reduce((m, c) => Math.max(m, c.at), 0);
  return `${s.label} · 7 days${newest ? ` to ${new Date(newest).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''} · ${s.lag}`;
}
