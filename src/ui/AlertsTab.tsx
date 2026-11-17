import { setShared } from '../data/bus';
import { useStore, type Incident } from '../data/store';
import { getPack, placesOf } from '../lib/packs';
import { describeLocation } from '../lib/places';
import { SOURCE_LABEL } from '../lib/signals';
import { fmtAgo, fmtTime } from './format';
import { openExternal } from './popout';
import { HitsInbox } from './MonitorsPanel';
import { ShareButton } from './TeamTab';
import { Icon, type IconName } from './Icon';

const KIND_ICON: Record<Incident['kind'], IconName> = { orbit: 'orbit', squawk: 'warning', weather: 'cloud', tfr: 'noentry', drone: 'drone', fire: 'flame', quake: 'quake', flood: 'flood', storm: 'bolt', air: 'wind', airport: 'plane', hotspot: 'satellite' };

export function ClusterCards() {
  const clusters = useStore((s) => s.clusters);
  const pack = useStore((s) => getPack(s.packId));
  if (!clusters.length) return null;
  const places = placesOf(pack);
  return (
    <div className="clusters">
      {clusters.map((c) => (
        <article key={c.id} className={`cluster sev-${c.severity}`} onClick={() => setShared({ focus: { at: Date.now(), center: c.center, zoom: 14 } })}>
          <div className="cluster-head">
            <span className="tag crit">DEVELOPING</span>
            <span className="mono muted">
              {fmtTime(c.firstAt, pack.timezone)}–{fmtTime(c.lastAt, pack.timezone)}
            </span>
          </div>
          <div className="cluster-title">
            {c.title}
            {describeLocation(c.center, places) && <span className="muted"> {describeLocation(c.center, places)}</span>}
          </div>
          <div className="cluster-sources">
            {c.sources.map((s) => (
              <span key={s} className="src-chip">
                {SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
          <ul>
            {c.signals.slice(0, 6).map((s) => (
              <li key={s.id}>
                <span className="mono muted">{fmtTime(s.at, pack.timezone)}</span> {s.title}
              </li>
            ))}
          </ul>
          <ShareButton text={`Developing: ${c.title} (${c.sources.map((x) => SOURCE_LABEL[x]).join(', ')})`} at={c.center} label={c.title} />
        </article>
      ))}
    </div>
  );
}

export function AlertsTab() {
  const incidents = useStore((s) => s.incidents);
  const clusters = useStore((s) => s.clusters);
  const alerts = useStore((s) => s.alerts);
  const tz = useStore((s) => getPack(s.packId).timezone);

  const open = (i: Incident) => {
    if (i.hex) setShared({ selectedHex: i.hex, focus: i.location ? { at: Date.now(), center: i.location, zoom: 13 } : null });
    else if (i.location) setShared({ focus: { at: Date.now(), center: i.location } });
  };

  return (
    <div className="list">
      <HitsInbox />
      <ClusterCards />
      {incidents.length === 0 && clusters.length === 0 && (
        <div className="empty">All quiet. Developing incidents, circling aircraft, emergency squawks, drones, no-fly zones and NWS alerts appear here.</div>
      )}
      {incidents.map((i) => {
        const wx = i.alertId ? alerts.find((a) => a.id === i.alertId) : undefined;
        return (
          <article key={i.id} className={`incident sev-${i.severity}`} onClick={() => open(i)}>
            <div className="inc-icon"><Icon name={KIND_ICON[i.kind]} size={16} /></div>
            <div className="inc-body">
              <div className="inc-title">
                {i.title}
                <span className="mono muted">{fmtAgo(i.at)}</span>
              </div>
              <div className="inc-detail">{i.detail}</div>
              <ShareButton text={`${i.title}: ${i.detail}`} at={i.location} url={i.url} label={i.title} />
              {i.url && (
                <button className="link" onClick={(e) => { e.stopPropagation(); void openExternal(i.url!, i.title); }}>
                  FAA details ↗
                </button>
              )}
              {wx && (
                <details onClick={(e) => e.stopPropagation()}>
                  <summary className="mono muted">
                    {wx.senderName} · until {wx.expires ? fmtTime(Date.parse(wx.expires), tz) : '—'}
                  </summary>
                  <p>{wx.headline}</p>
                  {wx.description && <pre>{wx.description}</pre>}
                  {wx.instruction && <pre className="instr">{wx.instruction}</pre>}
                </details>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
