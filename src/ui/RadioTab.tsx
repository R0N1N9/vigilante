import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { openRadio } from './popout';

export function RadioTab() {
  const pack = useStore((s) => getPack(s.packId));
  return (
    <div className="list">
      <div className="callout">
        <b>Scanner radio</b>
        <p>
          Feeds play inside Vigilante in a small player window (Broadcastify's own player), so you can park it on another monitor and keep listening. Dashed circles on the map show each feed's approximate coverage; click one to tune in.
        </p>
        <p className="muted">{pack.notes}</p>
      </div>
      {pack.radioFeeds.map((f) => (
        <article key={f.url} className="radio-row">
          <button className="radio-play" onClick={() => void openRadio(f)} title={`Listen to ${f.name}`}>
            ▶
          </button>
          <div className="radio-body">
            <div className="radio-name">
              {f.name}
              {!f.url.includes('/webPlayer/') && <span className="tag info">BROWSE</span>}
            </div>
            <div className="muted small-text">{f.agency}</div>
          </div>
          {f.coverage && (
            <button className="btn small" onClick={() => setShared({ focus: { at: Date.now(), center: [f.coverage![0], f.coverage![1]], zoom: 10.5 } })} title="Show coverage on map">
              ⌖
            </button>
          )}
        </article>
      ))}
      <p className="muted small-text note">
        Some agencies (e.g. Denver PD) encrypt their radio; those can't be heard anywhere. Rows marked "Browse" open the full Broadcastify list for that area so you can pick a specific feed.
      </p>
    </div>
  );
}
