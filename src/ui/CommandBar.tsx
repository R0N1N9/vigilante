import { useEffect, useRef, useState } from 'react';
import { setShared } from '../data/bus';
import { setState, useStore, type Feed, type FeedName } from '../data/store';
import { PACKS, getPack } from '../lib/packs';
import { fmtAgo, fmtTime, tzAbbr } from './format';
import { POPOUT_VIEWS, popOut, type View } from './popout';

const FEED_LABEL: Record<FeedName, string> = { adsb: 'ADS-B', nws: 'NWS', tfr: 'FAA', traffic: 'ROADS', transit: 'TRANSIT', power: 'POWER', news: 'NEWS', drones: 'RID' };

function FeedDot({ name, feed }: { name: FeedName; feed: Feed }) {
  const label = feed.status === 'live' || feed.status === 'stale' ? fmtAgo(feed.at) : feed.status === 'error' ? 'ERR' : feed.status === 'off' ? 'off' : '…';
  return (
    <span className={`feed feed-${feed.status}`} title={`${FEED_LABEL[name]}: ${feed.status}${feed.error ? ` (${feed.error})` : ''}`}>
      <i />
      {FEED_LABEL[name]} <b>{label}</b>
    </span>
  );
}

function PopoutMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Pop out ▾
      </button>
      {open && (
        <div className="menu-list">
          <div className="menu-hint">Opens a window you can drag to another monitor</div>
          {POPOUT_VIEWS.map((v) => (
            <button key={v.view} onClick={() => { setOpen(false); void popOut(v.view); }}>
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommandBar({ view }: { view: View }) {
  const packId = useStore((s) => s.packId);
  const feeds = useStore((s) => s.feeds);
  const basemap = useStore((s) => s.basemap);
  const muted = useStore((s) => s.muted);
  const incidents = useStore((s) => s.incidents);
  const clusters = useStore((s) => s.clusters);
  const pack = getPack(packId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const top = Math.max(0, ...incidents.map((i) => i.severity), ...clusters.map((c) => c.severity));
  const count = incidents.length + clusters.length;

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
      <button className={`alerts-chip mono sev-${top}`} title="Active alerts and developing incidents" onClick={() => setState({ tab: 'alerts' })}>
        {count} ALERT{count === 1 ? '' : 'S'}
      </button>
      <div className="feeds mono">
        {(Object.keys(FEED_LABEL) as FeedName[]).map((k) => (
          <FeedDot key={k} name={k} feed={feeds[k]} />
        ))}
      </div>
      <div className="spacer" />
      {(view === 'console' || view === 'map') && (
        <div className="seg" aria-label="Basemap">
          <button className={basemap === 'dark' ? 'on' : ''} onClick={() => setState({ basemap: 'dark' })}>Dark</button>
          <button className={basemap === 'satellite' ? 'on' : ''} onClick={() => setState({ basemap: 'satellite' })}>Satellite</button>
        </div>
      )}
      <button className="btn" onClick={() => setState({ modal: 'brief' })} title="Situation brief">
        ☀ Brief
      </button>
      <button className="icon-btn" onClick={() => setShared({ muted: !muted })} title={muted ? 'Unmute alert tones' : 'Mute alert tones'}>
        {muted ? '🔇' : '🔔'}
      </button>
      <button className="icon-btn" onClick={() => setState({ modal: 'settings' })} title="Settings">
        ⚙
      </button>
      {view === 'console' && <PopoutMenu />}
    </header>
  );
}
