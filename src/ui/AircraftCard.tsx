import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { fmtNum } from './format';

export function AircraftCard() {
  const hex = useStore((s) => s.selectedHex);
  const a = useStore((s) => s.aircraft.find((x) => x.hex === s.selectedHex));
  const orbit = useStore((s) => (s.selectedHex ? s.orbiting[s.selectedHex] : undefined));
  if (!hex) return null;
  if (!a)
    return (
      <div className="overlay ac-card">
        <div className="ac-head">
          <b className="mono">{hex.toUpperCase()}</b>
          <button className="x" onClick={() => setShared({ selectedHex: null })}>×</button>
        </div>
        <div className="muted">Signal lost</div>
      </div>
    );
  const tags = [
    a.emergency && { t: a.emergency.toUpperCase(), c: 'crit' },
    a.kind === 'heli' && { t: 'HELICOPTER', c: 'warn' },
    a.military && { t: 'MILITARY', c: 'info' },
    orbit && { t: `CIRCLING ${orbit.turns.toFixed(1)}×`, c: 'warn' },
  ].filter(Boolean) as { t: string; c: string }[];

  return (
    <div className="overlay ac-card">
      <div className="ac-head">
        <div>
          <b className="mono big">{a.callsign}</b>
          <div className="muted mono">
            {a.reg || '—'} · {a.type || 'type ?'} · {a.hex.toUpperCase()}
          </div>
        </div>
        <button className="x" onClick={() => setShared({ selectedHex: null })} aria-label="Close">
          ×
        </button>
      </div>
      {a.desc && <div className="muted">{a.desc}</div>}
      {tags.length > 0 && (
        <div className="tags">
          {tags.map((t) => (
            <span key={t.t} className={`tag ${t.c}`}>
              {t.t}
            </span>
          ))}
        </div>
      )}
      <dl className="grid mono">
        <dt>ALT</dt>
        <dd>{a.onGround ? 'GROUND' : fmtNum(a.altFt, ' ft')}</dd>
        <dt>≈AGL</dt>
        <dd>{fmtNum(a.aglFt, ' ft')}</dd>
        <dt>GS</dt>
        <dd>{fmtNum(a.gsKt, ' kt')}</dd>
        <dt>TRK</dt>
        <dd>{a.track == null ? '—' : `${Math.round(a.track).toString().padStart(3, '0')}°`}</dd>
        <dt>V/S</dt>
        <dd>{fmtNum(a.vrateFpm, ' fpm')}</dd>
        <dt>SQWK</dt>
        <dd className={a.emergency ? 'crit' : ''}>{a.squawk || '—'}</dd>
        <dt>DIST</dt>
        <dd>{a.distNm.toFixed(1)} nm</dd>
        <dt>SEEN</dt>
        <dd>{a.seenS.toFixed(0)} s</dd>
      </dl>
    </div>
  );
}
