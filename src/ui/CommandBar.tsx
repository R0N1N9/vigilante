import { useEffect, useRef, useState } from 'react';
import { setShared } from '../data/bus';
import { setState, useStore, type Feed, type FeedName } from '../data/store';
import { isTauri } from '../lib/http';
import { getPack } from '../lib/packs';
import { LocationPicker } from './LocationPicker';
import { fmtAgo, fmtTime, tzAbbr } from './format';
import { POPOUT_VIEWS, popOut, type View } from './popout';

const FEED_LABEL: Record<FeedName, string> = {
  adsb: 'Aircraft (ADS-B)',
  nws: 'Weather alerts (NWS)',
  tfr: 'No-fly zones (FAA)',
  crime: 'Crime (police open data)',
  s311: '311 requests',
  fire: 'Wildfires (NIFC)',
  firms: 'Satellite fire (NASA FIRMS)',
  storms: 'Storm reports (NWS)',
  quakes: 'Earthquakes (USGS)',
  floods: 'River gauges (NOAA)',
  air: 'Air quality',
  airports: 'Airport status (FAA)',
  transit: 'Transit',
  power: 'Power outages (DOE)',
  news: 'News',
  wanted: 'FBI Wanted',
  cams: 'Cameras (USGS)',
  traffic: 'Roads (optional key)',
  ships: 'Ships (optional key)',
  drones: 'Drone Remote ID',
};

function feedText(f: Feed) {
  return f.status === 'live' || f.status === 'stale' ? fmtAgo(f.at) : f.status === 'error' ? 'ERROR' : f.status === 'off' ? 'off' : 'loading';
}

/** One compact chip for all data feeds; click for details. Keeps the top bar from overflowing. */
function FeedStatus() {
  const feeds = useStore((s) => s.feeds);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const names = Object.keys(FEED_LABEL) as FeedName[];
  const live = names.filter((n) => feeds[n].status === 'live').length;
  const errs = names.filter((n) => feeds[n].status === 'error').length;
  return (
    <div className="menu" ref={ref}>
      <button className={`feed-chip mono ${errs ? 'has-err' : ''}`} onClick={() => setOpen(!open)} title="Data feeds">
        <span className="dots">
          {names.map((n) => (
            <i key={n} className={`d-${feeds[n].status}`} />
          ))}
        </span>
        {live}/{names.length} LIVE
      </button>
      {open && (
        <div className="menu-list feeds-pop mono">
          {names.map((n) => (
            <div key={n} className={`feed-row feed-${feeds[n].status}`} title={feeds[n].error ?? ''}>
              <i />
              <span>{FEED_LABEL[n]}</span>
              <b>{feedText(feeds[n])}</b>
              {feeds[n].error && <small>{feeds[n].error}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [ref, close]);
}

function PopoutMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} title="Pop out a panel to another window or monitor">
        ⧉
      </button>
      {open && (
        <div className="menu-list right">
          <div className="menu-hint">{isTauri() ? 'POP OUT · drag the window to another monitor' : 'POP OUT · opens a synced browser tab'}</div>
          {POPOUT_VIEWS.map((v) => (
            <button
              key={v.view}
              onClick={() => {
                setOpen(false);
                void popOut(v.view);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MainViewSwitch() {
  const mainView = useStore((s) => s.mainView);
  return (
    <div className="seg" aria-label="Main view">
      <button className={mainView === 'map' ? 'on' : ''} onClick={() => setState({ mainView: 'map' })}>
        Map
      </button>
      <button className={mainView === 'dashboard' ? 'on' : ''} onClick={() => setState({ mainView: 'dashboard' })}>
        Dashboard
      </button>
    </div>
  );
}

export function CommandBar({ view, embed = false }: { view: View; embed?: boolean }) {
  const packId = useStore((s) => s.packId);
  const muted = useStore((s) => s.muted);
  const incidents = useStore((s) => s.incidents);
  const clusters = useStore((s) => s.clusters);
  const pack = getPack(packId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const openHits = useStore((s) => s.hits.filter((h) => !h.acked).length);
  const hitTop = useStore((s) => Math.max(0, ...s.hits.filter((h) => !h.acked).map((h) => h.severity)));
  const top = Math.max(0, hitTop, ...incidents.map((i) => i.severity), ...clusters.map((c) => c.severity));
  const count = incidents.length + clusters.length + openHits;

  return (
    <header className="cmdbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M5 6 L12 19 L19 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="brand-text">VIGILANCE</span>
      </div>
      <LocationPicker />
      <div className="clock mono">
        {fmtTime(now, pack.timezone, true)}
        <small>{tzAbbr(now, pack.timezone)}</small>
        <span className="zulu">{fmtTime(now, 'UTC')}Z</span>
      </div>
      <button className={`alerts-chip mono sev-${top}${openHits && hitTop >= 3 ? ' pulse' : ''}`} title="Active alerts and developing incidents" onClick={() => setState(embed ? { mainView: 'dashboard' } : { tab: 'alerts' })}>
        {count} ALERT{count === 1 ? '' : 'S'}
      </button>
      <FeedStatus />
      {view === 'console' && <MainViewSwitch />}
      <div className="spacer" />
      <div className="actions">
        {!embed && (
          <button className="btn" onClick={() => setState({ modal: 'brief' })} title="Situation brief">
            ☀ <span className="hide-sm">Brief</span>
          </button>
        )}
        <button className={`icon-btn ${muted ? 'muted' : ''}`} onClick={() => setShared({ muted: !muted })} title={muted ? 'Alert tones off. Click to turn on' : 'Alert tones on. Click to mute'} aria-pressed={muted} aria-label="Alert tones">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
            {muted ? (
              <path d="M16 9.5l5 5M21 9.5l-5 5" />
            ) : (
              <>
                <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
                <path d="M18.3 6.5a8 8 0 0 1 0 11" />
              </>
            )}
          </svg>
        </button>
        <button className="icon-btn" onClick={() => setState({ modal: 'about' })} title="About Vigilance · get the desktop and mobile app" aria-label="Get the app">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="7" y="3" width="10" height="18" rx="2" />
            <path d="M11 17.5h2" />
          </svg>
        </button>
        {!embed && <button className="icon-btn" onClick={() => setState({ modal: 'settings' })} title="Settings" aria-label="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
        </button>}
        {view === 'console' && !embed && <PopoutMenu />}
      </div>
    </header>
  );
}
