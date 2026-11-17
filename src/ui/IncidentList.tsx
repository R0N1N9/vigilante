import { setShared } from '../data/bus';
import { useStore, type Incident } from '../data/store';
import { getPack } from '../lib/packs';
import { fmtAgo, fmtTime } from './format';

const KIND_ICON: Record<Incident['kind'], string> = { orbit: '⟳', squawk: '⚠', weather: '☁' };

export function IncidentList({ grow = false }: { grow?: boolean }) {
  const incidents = useStore((s) => s.incidents);
  const alerts = useStore((s) => s.alerts);
  const tz = useStore((s) => getPack(s.packId).timezone);

  const open = (i: Incident) => {
    if (i.hex) {
      setShared({ selectedHex: i.hex, focus: i.location ? { at: Date.now(), center: i.location, zoom: 13 } : null });
    } else if (i.location) setShared({ focus: { at: Date.now(), center: i.location } });
  };

  return (
    <section className={`panel ${grow ? 'grow' : 'incidents'}`}>
      <div className="panel-head">
        <h2>ALERTS</h2>
        <span className="count mono">{incidents.length}</span>
      </div>
      <div className="list">
        {incidents.length === 0 && <div className="empty">All quiet. Circling aircraft, emergency squawks and NWS alerts show up here.</div>}
        {incidents.map((i) => {
          const wx = i.alertId ? alerts.find((a) => a.id === i.alertId) : undefined;
          return (
            <article key={i.id} className={`incident sev-${i.severity}`} onClick={() => open(i)}>
              <div className="inc-icon">{KIND_ICON[i.kind]}</div>
              <div className="inc-body">
                <div className="inc-title">
                  {i.title}
                  <span className="mono muted">{fmtAgo(i.at)}</span>
                </div>
                <div className="inc-detail">{i.detail}</div>
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
    </section>
  );
}
