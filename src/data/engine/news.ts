import { getTextRetry } from '../../lib/http';
import { dedupeNews, googleNewsUrl, parseFeed, type NewsItem } from '../../lib/news';
import { getPack, placesOf } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log } from './core';

const NEWS_MS = 5 * 60_000;
const KEEP_MS = 48 * 3600_000;

export function startNews(gen: number) {
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    const places = placesOf(pack);
    const sources = [...pack.news.feeds, { name: 'Google News', url: googleNewsUrl(pack.news.googleQuery) }];
    const results = await Promise.allSettled(sources.map(async (f) => parseFeed(await getTextRetry(f.url), f.name, places, pack.news.localTerms)));
    if (!alive(gen)) return;
    const ok = results.filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled');
    if (!ok.length) {
      setFeed('news', { status: 'error', at: getState().feeds.news.at, error: 'all news feeds failed' });
      publishData();
      return;
    }
    const cutoff = Date.now() - KEEP_MS;
    const news = dedupeNews(ok.flatMap((r) => r.value).filter((n) => n.published >= cutoff && n.title));
    const known = new Set(getState().news.map((n) => n.id));
    for (const n of news) {
      if (known.has(n.id) || n.severity < 1 || !n.local) continue;
      if (!first) log(`NEWS   ${n.source}: ${n.title.slice(0, 100)}`, n.severity);
      emitSignal({ id: n.id, source: 'news', kind: n.category, title: n.title, detail: n.place ? `${n.source}, ${n.place}` : n.source, severity: n.severity, at: n.published, location: n.location, url: n.url, packId: ctx.packId }, { quiet: first });
    }
    first = false;
    setState({ news });
    const failed = results.length - ok.length;
    setFeed('news', { status: failed ? 'stale' : 'live', at: Date.now(), error: failed ? `${failed} of ${results.length} feeds failed` : undefined });
    publishData();
  }, NEWS_MS);
}
