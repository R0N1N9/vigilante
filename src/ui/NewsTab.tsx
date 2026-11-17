import { useMemo, useState } from 'react';
import { setShared } from '../data/bus';
import { setState, useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { fmtAgo } from './format';
import { openExternal, openTvWindow, tvUrl, type TvMode } from './popout';

export function LiveTv() {
  const pack = useStore((s) => getPack(s.packId));
  const chosen = useStore((s) => s.tvChannel);
  const [mode, setMode] = useState<TvMode | null>(null);
  const channel = pack.liveTv.find((c) => c.channelId === chosen) ?? pack.liveTv[0];
  if (!channel) return null;
  return (
    <div className="tv">
      <div className="tv-head">
        <span className="tv-live">● TV</span>
        <select value={channel.channelId} onChange={(e) => setState({ tvChannel: e.target.value })} aria-label="Station">
          {pack.liveTv.map((c) => (
            <option key={c.channelId} value={c.channelId}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="seg small">
          <button className={mode === 'latest' ? 'on' : ''} onClick={() => setMode('latest')}>Latest</button>
          <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>Live now</button>
        </div>
        <button className="btn small" onClick={() => void openTvWindow(channel.channelId, channel.name, mode ?? 'latest')} title="Small always-on-top player window">
          Mini ↗
        </button>
      </div>
      <div className="tv-frame">
        {mode ? (
          <iframe
            key={`${channel.channelId}-${mode}`}
            src={`${tvUrl(channel.channelId, mode)}&mute=1`}
            title={`${channel.name} ${mode}`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button className="tv-play" onClick={() => setMode('latest')}>
            ▶ Play {channel.name}
            <small>Latest clips play any time. “Live now” works when the station is streaming (newscasts and breaking news).</small>
          </button>
        )}
      </div>
    </div>
  );
}

type Filter = 'safety' | 'all' | 'placed';

export function NewsTab({ withTv = true }: { withTv?: boolean }) {
  const news = useStore((s) => s.news);
  const feed = useStore((s) => s.feeds.news);
  const [filter, setFilter] = useState<Filter>('safety');
  const rows = useMemo(() => news.filter((n) => (filter === 'safety' ? n.severity >= 1 && n.local : filter === 'placed' ? !!n.location : true)), [news, filter]);

  return (
    <div className="list">
      {withTv && <LiveTv />}
      <div className="row-head">
        <div className="seg small">
          {(['safety', 'placed', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'safety' ? 'Local safety' : f === 'placed' ? 'On map' : 'All'}
            </button>
          ))}
        </div>
        <span className="mono muted small-text">{rows.length} stories{feed.error ? ` · ${feed.error}` : ''}</span>
      </div>
      {rows.map((n) => (
        <article key={n.id} className={`news-item sev-${n.severity}`}>
          {n.image ? <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : <div className="news-noimg">{n.category.slice(0, 1).toUpperCase()}</div>}
          <div className="news-body">
            <div className="news-meta mono">
              {n.source} · {fmtAgo(n.published)}
              {n.place && (
                <button className="place" onClick={() => setShared({ focus: { at: Date.now(), center: n.location!, zoom: 13 } })} title="Show on map">
                  ⌖ {n.place}
                </button>
              )}
            </div>
            <button className="news-title" onClick={() => void openExternal(n.url, n.source)}>
              {n.title}
            </button>
            {n.summary && <div className="news-sum">{n.summary}</div>}
          </div>
        </article>
      ))}
      {!rows.length && <div className="empty">{feed.status === 'idle' ? 'Loading local news…' : 'No matching stories in the last 48 hours.'}</div>}
    </div>
  );
}
