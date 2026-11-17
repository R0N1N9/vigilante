import { setShared } from '../data/bus';
import { setState, useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { fmtAgo } from './format';

export function TrafficTab() {
  const events = useStore((s) => s.traffic);
  const feed = useStore((s) => s.feeds.traffic);
  const pack = useStore((s) => getPack(s.packId));
  const provider = pack.traffic.provider === 'ga511' ? 'Georgia 511' : 'COtrip (CDOT)';
  if (pack.traffic.provider === 'none')
    return (
      <div className="list">
        <div className="empty">No road-incident feed is set up for this state yet. Georgia (511) and Colorado (COtrip) are supported today.</div>
      </div>
    );

  if (feed.status === 'off')
    return (
      <div className="list">
        <div className="callout">
          <b>Road incidents and cameras need a free {provider} key.</b>
          <p>{pack.traffic.provider === 'ga511' ? 'Create an account at 511ga.org, then request a developer key under Developers.' : 'Sign up at manage-api.cotrip.org for a free COtrip data key.'}</p>
          <button className="btn" onClick={() => setState({ modal: 'settings' })}>
            Open Settings
          </button>
        </div>
      </div>
    );

  const shown = events.filter((e) => e.severity >= 1);
  return (
    <div className="list">
      <div className="row-head">
        <span className="mono muted small-text">
          {shown.length} incidents · {events.length - shown.length} roadwork hidden · {provider}
        </span>
      </div>
      {shown.map((e) => (
        <article key={e.id} className={`incident sev-${e.severity}`} onClick={() => setShared({ focus: { at: Date.now(), center: e.location, zoom: 14 } })}>
          <div className="inc-icon">{e.fullClosure ? '⛔' : '▲'}</div>
          <div className="inc-body">
            <div className="inc-title">
              {e.title}
              <span className="mono muted">{e.updated ? fmtAgo(e.updated) : ''}</span>
            </div>
            <div className="inc-detail">{e.description}</div>
          </div>
        </article>
      ))}
      {!shown.length && <div className="empty">{feed.status === 'idle' ? 'Loading…' : 'No road incidents in the area right now.'}</div>}
    </div>
  );
}
