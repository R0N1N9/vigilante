import { useState } from 'react';
import { setShared } from '../data/bus';
import { useStore, type Layers } from '../data/store';

const CEILINGS: { label: string; value: number | null }[] = [
  { label: 'All', value: null },
  { label: '18k', value: 18_000 },
  { label: '10k', value: 10_000 },
  { label: '5k', value: 5_000 },
  { label: '2k', value: 2_000 },
];

const ROWS: [keyof Layers, string, string][] = [
  ['aircraft', 'Aircraft', '#8FA3B8'],
  ['trails', 'Trails', '#3B4B5C'],
  ['drones', 'Drones', '#C084FC'],
  ['tfr', 'FAA no-fly zones', '#FF4D4F'],
  ['weather', 'NWS alerts', '#FFB020'],
  ['traffic', 'Road incidents', '#FF7A45'],
  ['transit', 'Transit disruptions', '#34D399'],
  ['outages', 'Power outages (county)', '#FDE68A'],
  ['cameras', 'Traffic cameras', '#7DD3FC'],
  ['news', 'News (placed)', '#4C8DFF'],
  ['areas', 'Watch areas', '#3DD6F5'],
  ['aoi', 'Area ring', '#3DD6F5'],
];

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const ceiling = useStore((s) => s.ceilingAglFt);
  const hideGround = useStore((s) => s.hideGround);
  const [open, setOpen] = useState(true);
  const toggle = (k: keyof Layers) => setShared({ layers: { ...layers, [k]: !layers[k] } });

  return (
    <div className={`overlay layer-panel ${open ? '' : 'closed'}`}>
      <button className="overlay-head" onClick={() => setOpen(!open)}>
        LAYERS <span>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="overlay-body">
          {ROWS.map(([k, label, swatch]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} />
              <i style={{ background: swatch }} />
              {label}
            </label>
          ))}
          <div className="sub">Max aircraft altitude (ft AGL)</div>
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
        </div>
      )}
    </div>
  );
}
