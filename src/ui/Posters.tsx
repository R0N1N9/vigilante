import { useMemo, useState } from 'react';
import { setState, useStore } from '../data/store';
import { getPack } from '../lib/packs';
import type { PosterKind, Wanted } from '../lib/intel';
import { openExternal } from './popout';
import { shareToTeam } from './TeamTab';
import { fmtAgo } from './format';

/** Official places to report and to search for more missing people. */
const FBI_TIPS = 'https://tips.fbi.gov/';
const NCMEC_SEARCH = 'https://www.missingkids.org/search';
const NAMUS = 'https://namus.nij.ojp.gov/';

const KIND_LABEL: Record<PosterKind | 'all', string> = { all: 'All', wanted: 'Wanted', missing: 'Missing', info: 'Seeking info' };

export const openPoster = (id: string) => setState({ modal: 'poster', posterId: id });

function PosterCard({ w, compact = false }: { w: Wanted; compact?: boolean }) {
  return (
    <button className={`poster ${w.kind} ${compact ? 'compact' : ''}`} onClick={() => openPoster(w.id)} title={`${w.label}: ${w.title}`}>
      <span className="poster-band">{w.kind === 'info' ? 'SEEKING INFO' : w.kind === 'wanted' && w.label !== 'WANTED' ? w.label.replace('WANTED · ', '') : w.label}</span>
      <span className="poster-photo">
        {w.image ? <img src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement('i'), { textContent: 'NO PHOTO' }))} /> : <i>NO PHOTO</i>}
      </span>
      <span className="poster-name">{w.title}</span>
      {!compact && (
        <>
          <span className="poster-sub">{w.kind === 'missing' ? w.summary.replace(/\s+/g, ' ').slice(0, 60) : w.subjects[0] ?? ''}</span>
          {w.warning && <span className="poster-warn">⚠ {w.warning.toLowerCase()}</span>}
          {w.reward && <span className="poster-reward">{w.reward.replace(/^(The FBI is offering a reward of )?/i, '').slice(0, 70)}</span>}
        </>
      )}
    </button>
  );
}

/** Poster wall for the City tab and the pop-out. */
export function PosterBoard() {
  const wanted = useStore((s) => s.wanted);
  const feed = useStore((s) => s.feeds.wanted);
  const pack = useStore((s) => getPack(s.packId));
  const [kind, setKind] = useState<PosterKind | 'all'>('all');
  const counts = useMemo(() => ({ all: wanted.length, wanted: wanted.filter((w) => w.kind === 'wanted').length, missing: wanted.filter((w) => w.kind === 'missing').length, info: wanted.filter((w) => w.kind === 'info').length }), [wanted]);
  // Missing people first, then newest.
  const rows = useMemo(() => wanted.filter((w) => kind === 'all' || w.kind === kind).sort((a, b) => Number(b.kind === 'missing') - Number(a.kind === 'missing') || b.published - a.published), [wanted, kind]);
  return (
    <div className="list">
      <div className="source mono small-text muted">
        FBI posters · {pack.intel.fbiOffice ? `${pack.intel.fbiOffice} field office` : 'no field office for this area'} · {feed.status === 'live' ? `updated ${fmtAgo(feed.at)} ago` : feed.error ?? feed.status}
      </div>
      <div className="callout">
        <p>
          <b>If you recognize someone, don't approach them.</b> Call 911 if there's immediate danger, otherwise submit a tip to the FBI. Many posters are for victims and missing people, not suspects.
        </p>
        <div className="field-row">
          <button className="btn small" onClick={() => void openExternal(FBI_TIPS, 'FBI tips')}>
            Submit an FBI tip ↗
          </button>
          <button className="btn small" onClick={() => void openExternal(NCMEC_SEARCH, 'NCMEC missing children')}>
            Missing children (NCMEC) ↗
          </button>
          <button className="btn small" onClick={() => void openExternal(NAMUS, 'NamUs')}>
            Missing persons (NamUs) ↗
          </button>
        </div>
      </div>
      <div className="chips">
        {(Object.keys(KIND_LABEL) as (PosterKind | 'all')[]).map((k) => (
          <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {KIND_LABEL[k]} · {counts[k]}
          </button>
        ))}
      </div>
      <div className="poster-grid">
        {rows.map((w) => (
          <PosterCard key={w.id} w={w} />
        ))}
      </div>
      {!rows.length && (
        <div className="empty">
          {wanted.length ? (
            'Nothing in this category.'
          ) : feed.status === 'error' ? (
            <>
              The FBI's site didn't answer ({feed.error}). It sometimes blocks automated requests for a while.{' '}
              <button className="link" onClick={() => void openExternal('https://www.fbi.gov/wanted', 'FBI Wanted')}>
                Open FBI Wanted ↗
              </button>
            </>
          ) : (
            'Loading posters…'
          )}
        </div>
      )}
    </div>
  );
}

/** Compact strip for the dashboard. */
export function PosterStrip({ max = 8 }: { max?: number }) {
  const wanted = useStore((s) => s.wanted);
  const rows = useMemo(() => [...wanted].sort((a, b) => Number(b.kind === 'missing') - Number(a.kind === 'missing') || b.published - a.published).slice(0, max), [wanted, max]);
  if (!rows.length) return <div className="empty">FBI posters for this area appear here.</div>;
  return (
    <div className="poster-strip">
      {rows.map((w) => (
        <PosterCard key={w.id} w={w} compact />
      ))}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return v ? (
    <div className="fact">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  ) : null;
}

export function PosterModal() {
  const w = useStore((s) => s.wanted.find((x) => x.id === s.posterId));
  if (!w) return null;
  const close = () => setState({ modal: null, posterId: null });
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className={`modal wide poster-modal ${w.kind}`} role="dialog" aria-label={`${w.label}: ${w.title}`}>
        <div className="modal-head">
          <h2>
            <span className="poster-kind">{w.label}</span> {w.title}
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="poster-full">
            <div className="poster-img">
              {w.imageLarge || w.image ? <img src={(w.imageLarge ?? w.image)!} alt={w.title} referrerPolicy="no-referrer" onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement('i'), { textContent: 'Photo unavailable' }))} /> : <i>No photo</i>}
            </div>
            <div className="poster-info">
              {w.warning && <div className="poster-alert">⚠ {w.warning}</div>}
              {w.summary && <p className="poster-summary">{w.summary}</p>}
              <div className="facts">
                <Fact k="Sex" v={w.sex} />
                <Fact k="Race" v={w.race} />
                <Fact k="Hair" v={w.hair} />
                <Fact k="Eyes" v={w.eyes} />
                <Fact k="Height" v={w.height} />
                <Fact k="Weight" v={w.weight} />
                <Fact k="Born" v={w.dob.join(', ')} />
                <Fact k="Place of birth" v={w.placeOfBirth} />
                <Fact k="Aliases" v={w.aliases.join(', ')} />
              </div>
              {w.reward && <div className="poster-reward big">{w.reward}</div>}
              <div className="small-text muted">{w.subjects.join(' · ')}</div>
            </div>
          </div>
          {w.details && (
            <section>
              <h3>Details</h3>
              <p>{w.details}</p>
              {w.remarks && <p className="muted">{w.remarks}</p>}
            </section>
          )}
          <section className="poster-guidance">
            {w.kind === 'missing' ? (
              <p>
                <b>If you see this person,</b> call 911 or your local police right away, then submit an FBI tip. Note the time, place and what they were wearing. Please don't confront anyone they're with.
              </p>
            ) : (
              <p>
                <b>Do not approach.</b> If there's immediate danger call 911. Otherwise submit a tip to the FBI with what you saw, where and when.
              </p>
            )}
          </section>
        </div>
        <div className="modal-foot">
          <button className="btn small" onClick={() => shareToTeam(`${w.label}: ${w.title}${w.warning ? ` (${w.warning.toLowerCase()})` : ''}. FBI poster: ${w.url}`, undefined, w.url)}>
            ⇪ Share to team
          </button>
          {w.pdf && (
            <button className="btn small" onClick={() => void openExternal(w.pdf!, `Poster: ${w.title}`)}>
              Printable poster (PDF) ↗
            </button>
          )}
          <button className="btn small" onClick={() => void openExternal(w.url, w.title)}>
            FBI page ↗
          </button>
          <button className="btn small primary" onClick={() => void openExternal(FBI_TIPS, 'FBI tips')}>
            Submit a tip ↗
          </button>
        </div>
      </div>
    </div>
  );
}
