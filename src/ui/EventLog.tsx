import { useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { fmtTime } from './format';

/** Dispatch-style running log. `strip` renders a single-line ticker for the console footer. */
export function EventLog({ strip = false }: { strip?: boolean }) {
  const log = useStore((s) => s.log);
  const tz = useStore((s) => getPack(s.packId).timezone);
  if (strip) {
    return (
      <footer className="ticker mono">
        <span className="ticker-label">LOG</span>
        <div className="ticker-items">
          {log.slice(0, 8).map((e) => (
            <span key={e.id} className={`sev-${e.severity}`}>
              <b>{fmtTime(e.at, tz, true)}</b> {e.text}
            </span>
          ))}
        </div>
      </footer>
    );
  }
  return (
    <section className="panel grow">
      <div className="panel-head">
        <h2>EVENT LOG</h2>
        <span className="count mono">{log.length}</span>
      </div>
      <div className="list log mono">
        {log.map((e) => (
          <div key={e.id} className={`log-row sev-${e.severity}`}>
            <b>{fmtTime(e.at, tz, true)}</b> <span>{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
