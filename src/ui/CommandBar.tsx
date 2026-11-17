import { useEffect, useState } from 'react';
import { setShared } from '../data/bus';
import { setState, useStore, type FeedStatus } from '../data/store';
import { PACKS, getPack } from '../lib/packs';
import { fmtAgo, fmtTime, tzAbbr } from './format';
import { popOut, type View } from './popout';

function Feed({ name, status, at, error }: { name: string; status: FeedStatus; at: number; error?: string }) {
  const label = status === 'live' || status === 'stale' ? fmtAgo(at) : status === 'error' ? 'ERR' : '…';
  return (
    <span className={`feed feed-${status}`} title={`${name}: ${status}${error ? ` (${error})` : ''}`}>
      <i />
      {name} <b>{label}</b>
    </span>
  );
}

export function CommandBar({ view }: { view: View }) {
  const packId = useStore((s) => s.packId);
  const feeds = useStore((s) => s.feeds);
  const basemap = useStore((s) => s.basemap);
  const muted = useStore((s) => s.muted);
  const incidents = useStore((s) => s.incidents);
  const aircraft = useStore((s) => s.aircraft);
  const pack = getPack(packId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const top = incidents.reduce((m, i) => Math.max(m, i.severity), 0);
  const helis = aircraft.filter((a) => a.kind === 'heli').length;

  return (
    <header className="cmdbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M5 6 L12 19 L19 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        VIGILANTE
      </div>

      <div className="seg" role="tablist" aria-label="City">
        {PACKS.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === packId} className={p.id === packId ? 'on' : ''} onClick={() => setShared({ packId: p.id })}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="clock mono">
        {fmtTime(now, pack.timezone, true)}
        <small>{tzAbbr(now, pack.timezone)}</small>
      </div>

      <div className="stats mono">
        <span title="Aircraft in area">✈ {aircraft.length}</span>
        <span title="Helicopters in area" className={helis ? 'warn' : ''}>
          ◎ {helis}
        </span>
        <span className={`alerts-chip sev-${top}`} title="Active incidents">
          {incidents.length} ALERT{incidents.length === 1 ? '' : 'S'}
        </span>
      </div>

      <div className="feeds mono">
        <Feed name="ADS-B" {...feeds.adsb} />
        <Feed name="NWS" {...feeds.nws} />
      </div>

      <div className="spacer" />

      {view !== 'air' && view !== 'alerts' && (
        <div className="seg" aria-label="Basemap">
          <button className={basemap === 'dark' ? 'on' : ''} onClick={() => setState({ basemap: 'dark' })}>
            Dark
          </button>
          <button className={basemap === 'satellite' ? 'on' : ''} onClick={() => setState({ basemap: 'satellite' })}>
            Satellite
          </button>
        </div>
      )}

      <button className="icon-btn" onClick={() => setShared({ muted: !muted })} title={muted ? 'Unmute alert tones' : 'Mute alert tones'}>
        {muted ? '🔇' : '🔔'}
      </button>

      {view === 'console' && (
        <div className="popouts">
          <span>Pop out</span>
          <button onClick={() => void popOut('map')}>Map</button>
          <button onClick={() => void popOut('air')}>Aircraft</button>
          <button onClick={() => void popOut('alerts')}>Alerts</button>
        </div>
      )}
    </header>
  );
}
