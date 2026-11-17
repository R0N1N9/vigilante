import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { isTauri } from '../lib/http';
import { UA_TYPES } from '../lib/odid';
import { fmtAgo } from './format';

export function DronesTab() {
  const drones = useStore((s) => s.drones);
  const settings = useStore((s) => s.settings);
  const feed = useStore((s) => s.feeds.drones);
  const requests = useStore((s) => s.requests);
  const desktop = isTauri();

  return (
    <div className="list">
      <div className="callout">
        <b>Drone Remote ID</b>
        <p>
          Since 2023, most drones broadcast an FAA Remote ID: serial number, position, height and the pilot's location. It is a short-range radio broadcast (Bluetooth or Wi-Fi), not
          an internet feed, so you only see drones within a few hundred meters of this laptop.
        </p>
        <p className="muted">
          Many DJI drones broadcast over Wi-Fi only, which laptops can't receive. A ~$15 ESP32 receiver adds those. If a drone worries you, report it to local police (non-emergency)
          or the FAA. Don't approach the pilot.
        </p>
        <div className="btn-row">
          <label className="check">
            <input
              type="checkbox"
              disabled={!desktop}
              checked={settings.drones.scan}
              onChange={() => setShared({ settings: { ...settings, drones: { scan: !settings.drones.scan } } })}
            />
            Scan with this laptop's Bluetooth {desktop ? '' : '(desktop app only)'}
          </label>
          <button className="btn small" onClick={() => setShared({ requests: { ...requests, droneSim: Date.now() } })}>
            Simulate a drone
          </button>
        </div>
        <div className={`mono small-text feed-${feed.status}`}>
          Status: {feed.status}
          {feed.error ? ` · ${feed.error}` : ''}
        </div>
      </div>
      {drones.map((d) => (
        <article key={d.id} className="incident sev-1" onClick={() => d.location && setShared({ focus: { at: Date.now(), center: d.location, zoom: 16 } })}>
          <div className="inc-icon" style={{ color: '#C084FC' }}>
            ✣
          </div>
          <div className="inc-body">
            <div className="inc-title">
              {d.uasId || d.id}
              {d.simulated && <span className="tag info">SIMULATED</span>}
              <span className="mono muted">{fmtAgo(d.lastSeen)}</span>
            </div>
            <dl className="grid mono">
              <dt>TYPE</dt>
              <dd>{UA_TYPES[d.uaType] ?? '—'}</dd>
              <dt>HEIGHT</dt>
              <dd className={(d.heightM ?? 0) > 122 ? 'warn' : ''}>{d.heightM != null ? `${Math.round(d.heightM * 3.281)} ft` : '—'}</dd>
              <dt>SPEED</dt>
              <dd>{d.speedMs != null ? `${Math.round(d.speedMs * 2.237)} mph` : '—'}</dd>
              <dt>PILOT</dt>
              <dd>{d.operator ? 'located' : '—'}</dd>
            </dl>
            {d.operatorId && <div className="muted small-text">Operator ID {d.operatorId}</div>}
          </div>
        </article>
      ))}
      {!drones.length && <div className="empty">No drones detected.</div>}
    </div>
  );
}
