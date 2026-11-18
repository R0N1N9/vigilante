/** Phone page: the team's shared radio frequencies (plain chat lines), with Copy and Share. */
import { useMemo, useState } from 'react';
import type { ChatMessage } from '../lib/comms';
import { fmtMhz, FREQ_MODES, freqText, teamFreqs } from '../lib/teamext';
import { Icon } from './Icon';

export function FieldFreqs({ chat, callsign, onSend }: { chat: ChatMessage[]; callsign: string; onSend: (text: string) => Promise<void> }) {
  const freqs = useMemo(() => teamFreqs(chat), [chat]);
  const [open, setOpen] = useState(false);
  const [mhz, setMhz] = useState('');
  const [mode, setMode] = useState('NFM');
  const [tone, setTone] = useState('');
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState('');
  const f = Number(mhz);
  const ok = Number.isFinite(f) && f > 0 && f < 300_000;
  return (
    <div className="field-card freq-card">
      <div className="marks-head">
        <h3>Frequencies</h3>
        {!open && (
          <button className="field-btn ping-btn" onClick={() => setOpen(true)}>
            <Icon name="radio" size={16} />
            Share one
          </button>
        )}
      </div>
      {open && (
        <div className="mark-form">
          <div className="freq-row">
            <label>
              <span>MHz</span>
              <input inputMode="decimal" value={mhz} onChange={(e) => setMhz(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="462.5625" />
            </label>
            <label>
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
            <label>
              <span>Tone</span>
              <input value={tone} onChange={(e) => setTone(e.target.value.slice(0, 12))} placeholder="67.0" />
            </label>
            <label>
              <span>Label</span>
              <input value={label} onChange={(e) => setLabel(e.target.value.replace(/—/g, '-').slice(0, 40))} placeholder="Team channel" />
            </label>
          </div>
          <div className="row">
            <button className="field-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="field-btn go"
              disabled={!ok}
              onClick={() =>
                void onSend(freqText(f, mode, tone, label, callsign || 'Phone')).then(() => {
                  setOpen(false);
                  setMhz('');
                  setTone('');
                  setLabel('');
                })
              }
            >
              Share
            </button>
          </div>
        </div>
      )}
      {freqs.map((x) => {
        const k = `${x.mhz}|${x.mode}`;
        return (
          <div key={k} className="mark-item">
            <Icon name="radio" size={14} />
            <div>
              <b className="mono">{fmtMhz(x.mhz)}</b>
              <small>
                {[x.mode, x.tone && `tone ${x.tone}`, x.label].filter(Boolean).join(' · ')} · {x.by}
              </small>
            </div>
            <div className="mark-actions">
              <button onClick={() => void navigator.clipboard?.writeText(x.mhz.toFixed(4)).then(() => setCopied(k))}>{copied === k ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        );
      })}
      {!freqs.length && !open && <p className="small-text muted">No frequencies shared yet.</p>}
    </div>
  );
}
