/** Top-bar radio: what you're tuned to, plus the city's live scanners (OpenMHz) to play in the app. */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { getState, useStore } from '../data/store';
import { setShared } from '../data/bus';
import { getJson } from '../lib/http';
import { getPack, type CityPack } from '../lib/packs';
import { nearSystems, parseSystems, systemPage, systemsUrl, type OmhzSystem } from '../lib/openmhz';
import { setVolume, stop, tune, useTuned, useVolume } from '../lib/liveRadio';
import { openExternal, openRadio } from './popout';
import { Icon } from './Icon';
import { ShareFeed } from './RadioTab';

let systemsCache: { at: number; list: OmhzSystem[] } | null = null;
let systemsLoad: Promise<OmhzSystem[]> | null = null;
function loadSystems(): Promise<OmhzSystem[]> {
  if (systemsCache && Date.now() - systemsCache.at < 10 * 60_000) return Promise.resolve(systemsCache.list);
  systemsLoad ??= getJson(systemsUrl())
    .then((j) => {
      systemsCache = { at: Date.now(), list: parseSystems(j) };
      return systemsCache.list;
    })
    .finally(() => (systemsLoad = null));
  return systemsLoad;
}

/** Live scanners near a city: null while loading, or an error message. */
export function useScanners(pack: CityPack, when = true): OmhzSystem[] | null | string {
  const [v, setV] = useState<OmhzSystem[] | null | string>(null);
  useEffect(() => {
    if (!when) return;
    let live = true;
    setV(null);
    loadSystems()
      .then((all) => live && setV(nearSystems(all, pack)))
      .catch((e) => live && setV(e instanceof Error ? e.message : 'unavailable'));
    return () => {
      live = false;
    };
  }, [pack.id, when]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** A shared radio link: OpenMHz systems play here, Broadcastify opens its own player. */
export function listen(feed: { name: string; url: string }) {
  const m = /^https:\/\/openmhz\.com\/system\/([^/?#]+)/.exec(feed.url);
  if (m) void tune(decodeURIComponent(m[1]), feed.name);
  else if (/^https:\/\/www\.broadcastify\.com\//.test(feed.url)) void openRadio(feed);
  else void openExternal(feed.url, feed.name);
}

export function ScannerList({ pack, compact = false, share = false }: { pack: CityPack; compact?: boolean; share?: boolean }) {
  const tuned = useTuned();
  const list = useScanners(pack);
  if (list === null) return <p className="rd-note muted">Finding live scanners near {pack.name}…</p>;
  if (typeof list === 'string') return <p className="rd-note">Live scanners couldn’t load ({list}).</p>;
  if (!list.length) return <p className="rd-note muted">No live OpenMHz scanners in {pack.region} yet. Broadcastify feeds below.</p>;
  return (
    <>
      {list.map((s) => {
        const on = tuned?.system === s.shortName;
        const row = (
          <button key={s.shortName} className={`rd-feed${on ? ' on' : ''}`} onClick={() => (on ? stop() : void tune(s.shortName, s.name))} title={on ? 'Stop' : `Listen live to ${s.name}`}>
            <span className="rd-play">{on ? '■' : '▶'}</span>
            <span className="rd-label">
              {s.name}
              {!compact && <small>{[s.city, s.county && `${s.county} County`, s.callAvg ? `~${Math.round(s.callAvg)} calls/hr` : ''].filter(Boolean).join(' · ') || s.description}</small>}
            </span>
          </button>
        );
        return share ? (
          <div key={s.shortName} className="rd-feed-row">
            {row}
            <ShareFeed name={s.name} agency="Live scanner (OpenMHz)" url={systemPage(s.shortName)} />
          </div>
        ) : (
          row
        );
      })}
    </>
  );
}

export type RadioSource = 'openmhz' | 'broadcastify';
export const RADIO_SOURCES: Record<RadioSource, { label: string; note: string }> = {
  openmhz: { label: 'OpenMHz', note: 'Plays live scanner calls right here in the app' },
  broadcastify: { label: 'Broadcastify', note: 'Opens Broadcastify’s own player for each feed' },
};
export const setRadioSource = (source: RadioSource) => {
  const s = getState().settings;
  setShared({ settings: { ...s, radio: { ...s.radio, source } } });
};

/** Broadcastify feeds for the city (they open Broadcastify's own player). */
export function BroadcastifyList({ pack }: { pack: CityPack }) {
  return (
    <>
      {pack.radioFeeds
        .filter((f) => /broadcastify\.com/.test(f.url))
        .map((f) => (
          <button key={f.url} className="rd-feed" onClick={() => void openRadio(f)} title="Opens Broadcastify's player">
            <span className="rd-play">↗</span>
            <span className="rd-label">
              {f.name}
              <small>{f.agency}</small>
            </span>
          </button>
        ))}
    </>
  );
}

export function RadioDock() {
  const pack = useStore((s) => getPack(s.packId));
  const source = useStore((s) => s.settings.radio?.source ?? 'openmhz');
  const [cog, setCog] = useState(false);
  const tuned = useTuned();
  const vol = useVolume();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  const live = tuned?.status === 'playing';
  return (
    <div className="radio-dock" ref={box}>
      <button
        className={`radio-dock-btn${tuned ? ' tuned' : ''}${live ? ' live' : ''}${tuned?.status === 'error' ? ' err' : ''}${tuned?.emergency ? ' emerg' : ''}`}
        onClick={() => setOpen(!open)}
        title={tuned ? `Radio: ${tuned.name}${tuned.now ? ` · ${tuned.now}` : ''}` : 'Scanner radio'}
        aria-expanded={open}
      >
        <Icon name="radio" />
        <span className="rd-name">{tuned ? tuned.name : 'Radio'}</span>
        {live && (
          <span className="rd-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      {open && (
        <div className="menu-list right radio-pop">
          {tuned && (
            <div className="rd-now">
              <div>
                <small className={tuned.emergency ? 'emerg' : ''}>
                  {tuned.status === 'playing' ? (tuned.emergency ? 'EMERGENCY CALL' : 'ON AIR') : tuned.status === 'waiting' ? 'LISTENING · QUIET' : tuned.status === 'loading' ? 'TUNING…' : 'NO SIGNAL'}
                </small>
                <b>{tuned.name}</b>
                {tuned.now && <em>{tuned.now}</em>}
              </div>
              <button className="btn small" onClick={stop} title="Stop">
                ■ Stop
              </button>
            </div>
          )}
          {tuned && (
            <label className="rd-vol">
              <span>Volume</span>
              <input type="range" min={0} max={100} value={Math.round(vol * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
            </label>
          )}
          {tuned?.status === 'error' && (
            <p className="rd-note">
              Couldn’t reach this scanner ({tuned.error}).{' '}
              <button className="linkish" onClick={() => void openExternal(systemPage(tuned.system), tuned.name)}>
                Open on OpenMHz
              </button>
            </p>
          )}
          <div className="rd-cogrow">
            <span className="rd-head">Radio source · {RADIO_SOURCES[source].label}</span>
            <button className={`rd-cog${cog ? ' on' : ''}`} onClick={() => setCog(!cog)} title="Choose the default radio source" aria-expanded={cog}>
              <Icon name="cog" />
            </button>
          </div>
          {cog && (
            <div className="rd-sources" role="radiogroup" aria-label="Default radio source">
              {(Object.keys(RADIO_SOURCES) as RadioSource[]).map((k) => (
                <label key={k} className={source === k ? 'on' : ''}>
                  <input type="radio" name="radio-source" checked={source === k} onChange={() => setRadioSource(k)} />
                  <span>
                    <b>{RADIO_SOURCES[k].label}</b>
                    <small>{RADIO_SOURCES[k].note}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          {source === 'openmhz' ? (
            <>
              <div className="rd-head">Live scanners · {pack.name}</div>
              <ScannerList pack={pack} />
              <div className="rd-head">Broadcastify (opens their player)</div>
              <BroadcastifyList pack={pack} />
            </>
          ) : (
            <>
              <div className="rd-head">Broadcastify · {pack.name}</div>
              <BroadcastifyList pack={pack} />
              <div className="rd-head">Live scanners in the app (OpenMHz)</div>
              <ScannerList pack={pack} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Keeps a radio problem inside the radio: the rest of the app keeps running. */
export class RadioBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('radio panel', e);
    stop();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <button className="radio-dock-btn err" onClick={() => this.setState({ failed: false })} title="The radio hit a problem and was stopped. Tap to reload it.">
        <Icon name="radio" />
        <span className="rd-name">{this.props.label ?? 'Radio'} · retry</span>
      </button>
    );
  }
}
