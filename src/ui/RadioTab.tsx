import { useState } from 'react';
import { postToChannel } from '../data/engine/comms';
import { listenText } from '../lib/teamext';
import { APP } from '../lib/brand';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { listen, RadioBoundary, ScannerList } from './RadioDock';
import { stop, useTuned } from '../lib/liveRadio';
import { Icon } from './Icon';

/** Post a scanner feed to the team: teammates tap the link in chat to open the player and listen. */
export function ShareFeed({ name, agency, url }: { name: string; agency: string; url: string }) {
  const ch = useStore((s) => s.channels.find((c) => c.enabled));
  const callsign = useStore((s) => s.settings.team.callsign);
  const [done, setDone] = useState(false);
  if (!ch) return null;
  return (
    <button
      className="btn small share-feed"
      onClick={() => {
        postToChannel(ch.id, listenText(name, agency, callsign || 'Ops'), { url });
        setDone(true);
        window.setTimeout(() => setDone(false), 2000);
      }}
      title={`Share with ${ch.name}: teammates tap it to listen`}
    >
      <Icon name="share" />
      {done ? 'Shared' : 'Share'}
    </button>
  );
}

export function RadioTab() {
  const pack = useStore((s) => getPack(s.packId));
  const tuned = useTuned();
  const source = useStore((s) => s.settings.radio?.source ?? 'openmhz');
  const live = (
      <div className="radio-live">
      {tuned && (
        <div className="rd-now">
          <div>
            <small className={tuned.emergency ? 'emerg' : ''}>{tuned.status === 'playing' ? (tuned.emergency ? 'EMERGENCY CALL' : 'ON AIR') : tuned.status === 'waiting' ? 'LISTENING · QUIET' : tuned.status === 'loading' ? 'TUNING…' : 'NO SIGNAL'}</small>
            <b>{tuned.name}</b>
            {tuned.now && <em>{tuned.now}</em>}
          </div>
          <button className="btn small" onClick={stop}>
            ■ Stop
          </button>
        </div>
      )}
      <div className="rd-head">Live scanners (OpenMHz)</div>
      <RadioBoundary label="Live scanners">
        <ScannerList pack={pack} share />
      </RadioBoundary>
    </div>
  );
  return (
    <div className="list">
      <div className="callout">
        <b>Scanner radio</b>
        <p>
          Live scanners play right here in {APP}: each radio call plays seconds after it's made. The Radio button in the top bar shows what's on and has volume and stop. Broadcastify feeds open in their own player. Dashed circles on the map show each feed's approximate coverage; click one to tune in.
        </p>
        <p className="muted">{pack.notes}</p>
      </div>
      {source === 'openmhz' && live}
      {pack.radioFeeds.map((f) => (
        <article key={f.url} className="radio-row">
          <button className="radio-play" onClick={() => listen(f)} title={`Listen to ${f.name}`}>
            ▶
          </button>
          <div className="radio-body">
            <div className="radio-name">
              {f.name}
              {!f.url.includes('/webPlayer/') && <span className="tag info">BROWSE</span>}
            </div>
            <div className="muted small-text">{f.agency}</div>
          </div>
          <ShareFeed name={f.name} agency={f.agency} url={f.url} />
          {f.coverage && (
            <button className="btn small" onClick={() => setShared({ focus: { at: Date.now(), center: [f.coverage![0], f.coverage![1]], zoom: 10.5 } })} title="Show coverage on map">
              <Icon name="locate" />
            </button>
          )}
        </article>
      ))}
      {source === 'broadcastify' && live}
      <p className="muted small-text note">
        Some agencies (e.g. Denver PD) encrypt their radio; those can't be heard anywhere. Rows marked "Browse" open the full Broadcastify list for that area so you can pick a specific feed.
      </p>
    </div>
  );
}
