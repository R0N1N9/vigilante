import { useState } from 'react';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { fmtAgo } from './format';
import { openExternal } from './popout';
import { TrafficTab } from './TrafficTab';

function TransitList() {
  const transit = useStore((s) => s.transit);
  const feed = useStore((s) => s.feeds.transit);
  const pack = useStore((s) => getPack(s.packId));
  const [showPlanned, setShowPlanned] = useState(false);
  const rows = transit.filter((t) => showPlanned || t.severity >= 1 || t.kind === 'delays');
  return (
    <div className="list">
      <div className="row-head">
        <span className="mono muted small-text">
          {pack.transit.agency} · {rows.length} shown{feed.error ? ` · ${feed.error}` : ''}
          {feed.status === 'live' ? ` · ${fmtAgo(feed.at)} ago` : ''}
        </span>
        <label className="check small-text">
          <input type="checkbox" checked={showPlanned} onChange={() => setShowPlanned(!showPlanned)} /> planned work
        </label>
      </div>
      {pack.transit.agency === 'MARTA' && (
        <p className="muted small-text note">MARTA doesn't publish an alerts feed. These are bus routes where several buses are running 15+ minutes late, from MARTA's live data. Rail isn't included.</p>
      )}
      {rows.map((t) => (
        <article key={t.id} className={`incident sev-${t.severity}`} onClick={() => t.location && setShared({ focus: { at: Date.now(), center: t.location, zoom: 14 } })}>
          <div className="inc-icon" style={{ color: '#34D399' }}>
            ▣
          </div>
          <div className="inc-body">
            <div className="inc-title">
              {t.title}
              {t.cause && !/^(Unknown|Other) cause$/.test(t.cause) && <span className={`tag ${t.severity >= 2 ? 'crit' : 'info'}`}>{t.cause.toUpperCase()}</span>}
            </div>
            <div className="inc-detail">{t.detail}</div>
            {!t.location && <div className="muted small-text">Location unknown (route-wide)</div>}
          </div>
        </article>
      ))}
      {!rows.length && <div className="empty">{feed.status === 'idle' ? 'Loading transit data…' : 'No transit disruptions right now.'}</div>}
      <button className="link" onClick={() => void openExternal(pack.transit.infoUrl, `${pack.transit.agency} alerts`)}>
        Official {pack.transit.agency} alerts ↗
      </button>
    </div>
  );
}

function PowerList() {
  const outages = useStore((s) => s.outages);
  const feed = useStore((s) => s.feeds.power);
  const pack = useStore((s) => getPack(s.packId));
  const total = outages.reduce((n, o) => n + o.customers, 0);
  return (
    <div className="list">
      <div className="callout">
        <b>{total ? `${total.toLocaleString('en-US')} customers without power in the area` : 'No reported outages in the area'}</b>
        <p>
          County totals from the U.S. Department of Energy's ODIN program. Only utilities that report to ODIN are counted:{' '}
          {pack.id === 'denver' ? 'United Power and CORE Electric are; Xcel Energy, which serves most of Denver, is not.' : 'Georgia Power and the Georgia EMCs currently are not.'} For those, use the official maps below.
        </p>
        <div className="btn-row">
          {pack.power.utilities.map((u) => (
            <button key={u.name} className="btn small" onClick={() => void openExternal(u.url, `${u.name} outages`)}>
              {u.name} map ↗
            </button>
          ))}
        </div>
        {feed.error && <div className="mono small-text feed-error">{feed.error}</div>}
      </div>
      {outages.map((o) => (
        <article key={o.id} className={`incident sev-${o.severity}`}>
          <div className="inc-icon" style={{ color: '#FFB020' }}>
            ⚡
          </div>
          <div className="inc-body">
            <div className="inc-title">
              {o.county} County
              <span className="mono">{o.customers.toLocaleString('en-US')} out</span>
            </div>
            <div className="inc-detail">{o.utilities.join(', ')}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

type Section = 'roads' | 'transit' | 'power';

export function InfraTab() {
  const [section, setSection] = useState<Section>('roads');
  const roads = useStore((s) => s.traffic.filter((t) => t.severity >= 2).length);
  const transit = useStore((s) => s.transit.filter((t) => t.severity >= 1).length);
  const power = useStore((s) => s.outages.length);
  const counts: Record<Section, number> = { roads, transit, power };
  return (
    <>
      <div className="subtabs seg small">
        {(['roads', 'transit', 'power'] as Section[]).map((k) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
            {k === 'roads' ? 'Roads' : k === 'transit' ? 'Transit' : 'Power'}
            {counts[k] ? ` · ${counts[k]}` : ''}
          </button>
        ))}
      </div>
      {section === 'roads' ? <TrafficTab /> : section === 'transit' ? <TransitList /> : <PowerList />}
    </>
  );
}
