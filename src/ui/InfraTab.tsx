import { useMemo, useState } from 'react';
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

function FireList() {
  const fires = useStore((s) => s.fires);
  const feed = useStore((s) => s.feeds.fire);
  const news = useStore((s) => s.news);
  // Many outlets cover the same fire: group by place + category, newest first.
  const fireNews = useMemo(() => {
    const groups = new Map<string, { lead: (typeof news)[number]; more: number }>();
    for (const n of news) {
      if (!n.local || (n.category !== 'fire' && n.category !== 'rescue')) continue;
      const key = `${n.category}:${n.areaName ?? n.id}`;
      const g = groups.get(key);
      if (!g) groups.set(key, { lead: n, more: 0 });
      else g.more++;
    }
    return [...groups.values()];
  }, [news]);
  return (
    <div className="list">
      <div className="row-head">
        <span className="mono muted small-text">
          NIFC wildland fires within 75 nm{feed.error ? ` · ${feed.error}` : ''}
        </span>
      </div>
      {fires.map((f) => (
        <article key={f.id} className={`incident sev-${f.severity}`} onClick={() => setShared({ focus: { at: Date.now(), center: f.location, zoom: 11 } })}>
          <div className="inc-icon">{f.kind === 'prescribed' ? '♨' : '🔥'}</div>
          <div className="inc-body">
            <div className="inc-title">
              {f.name}
              <span className="mono muted">{Math.round(f.distNm)} nm</span>
            </div>
            <div className="inc-detail">
              {f.kind === 'prescribed' ? 'Prescribed burn' : 'Wildfire'}
              {f.acres != null ? ` · ${Math.round(f.acres).toLocaleString('en-US')} acres` : ''}
              {f.containedPct != null ? ` · ${f.containedPct}% contained` : ''}
              {f.county ? ` · ${f.county} County` : ''}
            </div>
          </div>
        </article>
      ))}
      {!fires.length && <div className="empty">{feed.status === 'idle' ? 'Loading…' : 'No active wildland fires reported nearby.'}</div>}
      <div className="row-head" style={{ marginTop: 10 }}>
        <span className="mono muted small-text">Structure fires & rescues in local news</span>
      </div>
      {fireNews.map(({ lead: n, more }) => (
        <article key={n.id} className={`incident sev-${n.severity}`} onClick={() => void openExternal(n.url, n.source)}>
          <div className="inc-icon">{n.category === 'rescue' ? '⛑' : '🔥'}</div>
          <div className="inc-body">
            <div className="inc-title">
              {n.title}
              <span className="mono muted">{fmtAgo(n.published)}</span>
            </div>
            <div className="inc-detail">
              {n.source}
              {n.areaName ? ` · ${n.precision === 'area' ? '≈ ' : ''}${n.areaName}` : ''}
              {more ? ` · +${more} more stor${more === 1 ? 'y' : 'ies'}` : ''}
            </div>
          </div>
        </article>
      ))}
      {!fireNews.length && <div className="empty">No fire or rescue stories in the last 48 hours.</div>}
      <p className="muted small-text note">Live fire-department dispatch isn't published as open data in Denver or Atlanta; listen on the Radio tab for fire dispatch.</p>
    </div>
  );
}

type Section = 'roads' | 'transit' | 'power' | 'fire';

export function InfraTab() {
  const [section, setSection] = useState<Section>('roads');
  const roads = useStore((s) => s.traffic.filter((t) => t.severity >= 2).length);
  const transit = useStore((s) => s.transit.filter((t) => t.severity >= 1).length);
  const power = useStore((s) => s.outages.length);
  const fire = useStore((s) => s.fires.filter((f) => f.severity >= 1).length);
  const counts: Record<Section, number> = { roads, transit, power, fire };
  return (
    <>
      <div className="subtabs seg small">
        {(['roads', 'transit', 'power', 'fire'] as Section[]).map((k) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
            {k === 'roads' ? 'Roads' : k === 'transit' ? 'Transit' : k === 'power' ? 'Power' : 'Fire'}
            {counts[k] ? ` · ${counts[k]}` : ''}
          </button>
        ))}
      </div>
      {section === 'roads' ? <TrafficTab /> : section === 'transit' ? <TransitList /> : section === 'power' ? <PowerList /> : <FireList />}
    </>
  );
}
