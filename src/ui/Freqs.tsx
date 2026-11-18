import { useMemo, useState } from 'react';
import { postToChannel } from '../data/engine/comms';
import { setState, useStore } from '../data/store';
import { ageText } from '../lib/team';
import { fmtMhz, FREQ_MODES, freqText, teamFreqs } from '../lib/teamext';
import { Icon } from './Icon';

/** Share a radio frequency with the team: a plain chat line every app (and the ntfy app) can read. */
export function FreqModal() {
  const all = useStore((s) => s.channels);
  const chans = useMemo(() => all.filter((c) => c.enabled), [all]);
  const callsign = useStore((s) => s.settings.team.callsign);
  const [mhz, setMhz] = useState('');
  const [mode, setMode] = useState('NFM');
  const [tone, setTone] = useState('');
  const [label, setLabel] = useState('');
  const [channelId, setChannelId] = useState(chans[0]?.id ?? '');
  const close = () => setState({ modal: null });
  const f = Number(mhz);
  const ok = Number.isFinite(f) && f > 0 && f < 300_000 && !!chans.length;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Share a frequency">
        <div className="modal-head">
          <h2>
            <Icon name="radio" size={18} className="accent" /> Share a frequency
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <section>
            <div className="freq-row">
              <label className="field">
                <span>Frequency (MHz)</span>
                <input autoFocus inputMode="decimal" value={mhz} onChange={(e) => setMhz(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="462.5625" />
              </label>
              <label className="field">
                <span>Mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="">—</option>
                  {FREQ_MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="freq-row">
              <label className="field">
                <span>Tone (optional)</span>
                <input value={tone} onChange={(e) => setTone(e.target.value.slice(0, 12))} placeholder="67.0" />
              </label>
              <label className="field">
                <span>Label (optional)</span>
                <input value={label} onChange={(e) => setLabel(e.target.value.replace(/—/g, '-').slice(0, 40))} placeholder="Team channel" />
              </label>
            </div>
            {chans.length > 1 && (
              <label className="field">
                <span>Channel</span>
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  {chans.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {ok && <p className="mono small-text muted">{freqText(f, mode, tone, label, callsign || 'Ops')}</p>}
          </section>
        </div>
        <div className="modal-foot">
          <button className="btn small" onClick={close}>
            Cancel
          </button>
          <button
            className="btn small primary"
            disabled={!ok}
            onClick={() => {
              postToChannel(channelId || chans[0].id, freqText(f, mode, tone, label, callsign || 'Ops'));
              close();
            }}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

export function useTeamFreqs() {
  const chat = useStore((s) => s.chat);
  return useMemo(() => teamFreqs(chat), [chat]);
}

export function FreqList() {
  const freqs = useTeamFreqs();
  const [copied, setCopied] = useState('');
  return (
    <div className="freq-list">
      {freqs.map((f) => {
        const k = `${f.mhz}|${f.mode}`;
        return (
          <div key={k} className="freq-item">
            <b className="mono">{fmtMhz(f.mhz)}</b>
            <span className="mono muted">{[f.mode, f.tone && `tone ${f.tone}`].filter(Boolean).join(' · ')}</span>
            <span>{f.label}</span>
            <small className="muted">
              {f.by} · {ageText(Date.now() - f.at)} ago
            </small>
            <button
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(f.mhz.toFixed(4)).then(() => setCopied(k));
              }}
            >
              {copied === k ? 'Copied' : 'Copy'}
            </button>
          </div>
        );
      })}
      <button className="btn small" onClick={() => setState({ modal: 'freq' })}>
        <Icon name="radio" />
        Share a frequency
      </button>
    </div>
  );
}
