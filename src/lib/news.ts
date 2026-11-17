import type { LonLat } from './geo';
import type { Place } from './packs';
import { matchPlaces } from './places';
import type { Severity } from './signals';

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published: number;
  image: string | null;
  place: string | null;
  location: LonLat | null;
  severity: Severity;
  category: 'crime' | 'fire' | 'traffic' | 'weather' | 'missing' | 'general';
  /** Mentions a local place or city/county name. Station feeds also carry national stories. */
  local: boolean;
}

const HIGH = /\b(shooting|shot|shots fired|stabbing|stabbed|homicide|murder|killed|carjack\w*|kidnap\w*|hostage|swat|standoff|explosion|active shooter|manhunt|barricaded)\b/i;
const MEDIUM = /\b(robbery|robbed|burglar\w*|break-ins?|arrest\w*|police chase|pursuit|fire|blaze|crash|wreck|missing|amber alert|evacuat\w*|hazmat|lockdown|assault\w*|theft|stolen|vandal\w*|gunfire|police)\b/i;

const CATEGORY: [NewsItem['category'], RegExp][] = [
  ['missing', /\b(missing|amber alert|endangered)\b/i],
  ['fire', /\b(fire|blaze|smoke|burn\w*|firefighters?)\b/i],
  ['traffic', /\b(crash|wreck|closure|closed|lanes?|interstate|i-\d+|highway|traffic)\b/i],
  ['weather', /\b(storm|tornado|snow|hail|flood\w*|blizzard|weather|wind)\b/i],
  ['crime', /\b(police|shoot\w*|shot|stab\w*|homicide|murder|robb\w*|burglar\w*|arrest\w*|carjack\w*|theft|assault\w*|suspect|swat|crime)\b/i],
];

export function classify(text: string): { severity: Severity; category: NewsItem['category'] } {
  const severity: Severity = HIGH.test(text) ? 2 : MEDIUM.test(text) ? 1 : 0;
  const category = CATEGORY.find(([, re]) => re.test(text))?.[0] ?? 'general';
  return { severity, category };
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const MEDIA_NS = 'http://search.yahoo.com/mrss/';

function mediaEl(it: Element, local: string): Element | undefined {
  return it.getElementsByTagNameNS(MEDIA_NS, local)[0] ?? it.getElementsByTagName(`media:${local}`)[0];
}

/** First image for an item: media:content, media:thumbnail, then an image enclosure. */
function imageOf(it: Element): string | null {
  const content = mediaEl(it, 'content');
  if (content && (content.getAttribute('medium') ?? 'image') === 'image' && !/\.(mp4|m3u8)(\?|$)/i.test(content.getAttribute('url') ?? ''))
    return content.getAttribute('url');
  const thumb = mediaEl(it, 'thumbnail')?.getAttribute('url');
  if (thumb) return thumb;
  const enc = it.querySelector('enclosure');
  if (enc && (enc.getAttribute('type') ?? 'image/').startsWith('image')) return enc.getAttribute('url');
  return null;
}

/** Parse an RSS 2.0 feed (also tolerates Atom). `parser` is injectable for tests. */
export function isLocal(text: string, places: Place[], localTerms: string[]): boolean {
  if (matchPlaces(text, places).length) return true;
  return localTerms.some((t) => new RegExp(`(^|[^A-Za-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(text));
}

export function parseFeed(xml: string, sourceName: string, places: Place[], localTerms: string[] = [], parser = new DOMParser()): NewsItem[] {
  const doc = parser.parseFromString(xml, 'text/xml');
  const items = [...doc.querySelectorAll('item, entry')];
  return items.map((it) => {
    const title = stripHtml(text(it.querySelector('title')));
    const link = text(it.querySelector('link')) || it.querySelector('link')?.getAttribute('href') || '';
    const summary = stripHtml(text(it.querySelector('description, summary'))).slice(0, 400);
    const date = text(it.querySelector('pubDate, published, updated'));
    const media = imageOf(it);
    // Google News titles end with " - Outlet".
    const gSource = sourceName === 'Google News' ? (title.match(/ - ([^-]+)$/)?.[1] ?? null) : null;
    const cleanTitle = gSource ? title.replace(/ - [^-]+$/, '') : title;
    const full = `${cleanTitle}. ${summary}`;
    const match = matchPlaces(full, places)[0] ?? null;
    const { severity, category } = classify(full);
    return {
      id: `news:${hash(link || cleanTitle)}`,
      source: gSource ?? sourceName,
      title: cleanTitle,
      summary: sourceName === 'Google News' ? '' : summary,
      url: link,
      published: Date.parse(date) || Date.now(),
      image: media || null,
      place: match?.place.name ?? null,
      location: match?.place.at ?? null,
      severity,
      category,
      local: isLocal(full, places, localTerms),
    };
  });
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

/** Jaccard similarity of title words, used to merge the same story from several outlets. */
export function titleSimilarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

/** Newest first, near-duplicate stories collapsed (keeps the richest copy). */
export function dedupeNews(items: NewsItem[], threshold = 0.55): NewsItem[] {
  const out: NewsItem[] = [];
  for (const it of [...items].sort((a, b) => b.published - a.published)) {
    const dup = out.find((o) => o.id === it.id || titleSimilarity(o.title, it.title) >= threshold);
    if (!dup) out.push(it);
    else if (!dup.location && it.location) Object.assign(dup, { place: it.place, location: it.location });
  }
  return out;
}

export function googleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}
