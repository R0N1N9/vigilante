import { useState } from 'react';
import { setShared } from '../data/bus';
import { useStore, type SharedUi } from '../data/store';

const CEILINGS: { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: '18k', value: 18_000 },
  { label: '10k', value: 10_000 },
  { label: '5k', value: 5_000 },
  { label: '2k', value: 2_000 },
];

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const ceiling = useStore((s) => s.ceilingAglFt);
  const hideGround = useStore((s) => s.hideGround);
  const [open, setOpen] = useState(true);

  const toggle = (k: keyof SharedUi['layers']) => setShared({ layers: { ...layers, [k]: !layers[k] } });
  const row = (k: keyof SharedUi['layers'], label: string, swatch: string) => (
    <label className="check">
      <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
      <i style={{ background: swatch }} />
      {label}
    </label>
  );

  return (
    <div className={`overlay layer-panel ${open ? '' : 'closed'}`}>
      <button className="overlay-head" onClick={() => setOpen(!open)}>
        LAYERS <span>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="overlay-body">
          {row('aircraft', 'Aircraft', '#8FA3B8')}
          {row('trails', 'Trails', '#3B4B5C')}
          {row('weather', 'NWS alerts', '#FFB020')}
          {row('aoi', 'Area ring', '#3DD6F5')}
          <div className="sub">Max altitude (ft AGL)</div>
          <div className="seg small">
            {CEILINGS.map((c) => (
              <button key={c.label} className={ceiling === c.value ? 'on' : ''} onClick={() => setShared({ ceilingAglFt: c.value })}>
                {c.label}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={hideGround} onChange={() => setShared({ hideGround: !hideGround })} />
            Hide aircraft on ground
          </label>
          <div className="legend">
            <span><i style={{ background: '#FF4D4F' }} />Emergency</span>
            <span><i style={{ background: '#FFB020' }} />Helicopter</span>
            <span><i style={{ background: '#4C8DFF' }} />Military</span>
            <span><i style={{ background: '#E6EDF3' }} />Low &lt;3k</span>
          </div>
        </div>
      )}
    </div>
  );
}
