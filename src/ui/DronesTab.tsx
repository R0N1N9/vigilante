import { useState } from 'react';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { isTauri } from '../lib/http';
import { UA_TYPES } from '../lib/odid';
import { fmtAgo } from './format';
import { Icon } from './Icon';

function WifiReceiver() {
  const settings = useStore((s) => s.settings);
  const [iface, setIface] = useState(settings.drones.wifiIface || 'wlan0mon');
  const on = !!settings.drones.wifiIface;
  if (!isTauri()) return null;
  return (
    <details className="wifi-rid" open={on}>
      <summary>Wi-Fi Remote ID (DJI Mavic 3 and other Wi-Fi drones) · Linux</summary>
      <p className="muted small-text">
        DJI drones such as the Mavic 3 send Remote ID as Wi-Fi beacons, not Bluetooth. Put a Wi-Fi adapter in monitor mode on channel 6, give the app raw-capture permission, then start
        the receiver:
      </p>
      <pre className="cmd">{`sudo airmon-ng start wlan0
sudo iw dev wlan0mon set channel 6
sudo setcap cap_net_raw+ep src-tauri/target/debug/vigilante`}</pre>
      <div className="btn-row">
        <input value={iface} onChange={(e) => setIface(e.target.value.replace(/[^\w.-]/g, ''))} aria-label="Monitor interface" style={{ width: 120 }} />
        <button className="btn small" onClick={() => setShared({ settings: { ...settings, drones: { ...settings.drones, wifiIface: on ? '' : iface } } })}>
          {on ? 'Stop Wi-Fi receiver' : 'Start Wi-Fi receiver'}
        </button>
      </div>
      <p className="muted small-text">The drone must have Remote ID active (current firmware) and usually a GPS lock before it broadcasts. Monitor mode disconnects that adapter from your Wi-Fi network.</p>
    </details>
  );
}

export function DronesTab() {
  const drones = useStore((s) => s.drones);
  const settings = useStore((s) => s.settings);
  const feed = useStore((s) => s.feeds.drones);
  const requests = useStore((s) => s.requests);
  const desktop = isTauri();

  return (
    <div className="list">
      {!desktop && (
        <div className="callout">
          <b>Drone scanning needs the desktop app</b>
          <p>Remote ID is a short-range Bluetooth or Wi-Fi broadcast, and web browsers can't listen for it. Install the desktop app (Get the app, top bar) to see drones near you.</p>
        </div>
      )}
      <div className="callout">
        <b>Drone Remote ID</b>
        <p>
          Since 2023, most drones broadcast an FAA Remote ID: serial number, position, height and the pilot's location. It is a short-range radio broadcast (Bluetooth or Wi-Fi), not
          an internet feed, so you only see drones within a few hundred meters of this laptop.
        </p>
        <p className="muted">
          DJI drones (Mavic 3, Mini, Air) broadcast over Wi-Fi, which Bluetooth can't see. Use the Wi-Fi receiver below (Linux, monitor mode). If a drone worries you, report it to
          local police (non-emergency) or the FAA. Don't approach the pilot.
        </p>
        <div className="btn-row">
          <label className="check">
            <input
              type="checkbox"
              disabled={!desktop}
              checked={settings.drones.scan}
              onChange={() => setShared({ settings: { ...settings, drones: { ...settings.drones, scan: !settings.drones.scan } } })}
            />
            Scan with this laptop's Bluetooth {desktop ? '' : '(desktop app only)'}
          </label>
          <button className="btn small" onClick={() => setShared({ requests: { ...requests, droneSim: Date.now() } })}>
            Simulate a drone
          </button>
        </div>
        <WifiReceiver />
        <div className={`mono small-text feed-${feed.status}`}>
          Status: {feed.status}
          {feed.error ? ` · ${feed.error}` : ''}
        </div>
      </div>
      {drones.map((d) => (
        <article key={d.id} className="incident sev-1" onClick={() => d.location && setShared({ focus: { at: Date.now(), center: d.location, zoom: 16 } })}>
          <div className="inc-icon" style={{ color: '#C084FC' }}>
            <Icon name="drone" size={16} />
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
