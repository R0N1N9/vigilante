import { useState } from 'react';
import { isEmbed } from '../lib/embed';
import { setShared } from '../data/bus';
import { setState, useStore, type Layers } from '../data/store';

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
  ['crime', 'Crime (7 days)', '#FF4D4F'],
  ['s311', '311 requests', '#A3E635'],
  ['radar', 'Weather radar', '#38BDF8'],
  ['fires', 'Wildfires (NIFC)', '#FF7A45'],
  ['hotspots', 'Satellite heat (FIRMS)', '#FF3D00'],
  ['storms', 'Storm reports', '#FFB020'],
  ['quakes', 'Earthquakes', '#C084FC'],
  ['floods', 'River gauges', '#38BDF8'],
  ['ships', 'Ships (AIS)', '#7DD3FC'],
  ['radio', 'Radio coverage', '#2DD4BF'],
  ['traffic', 'Road incidents', '#FF7A45'],
  ['transit', 'Transit disruptions', '#34D399'],
  ['outages', 'Power outages (county)', '#FDE68A'],
  ['cameras', 'Cameras', '#7DD3FC'],
  ['news', 'News (placed)', '#4C8DFF'],
  ['areas', 'Watch areas', '#3DD6F5'],
  ['aoi', 'Area ring', '#3DD6F5'],
];

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const ceiling = useStore((s) => s.ceilingAglFt);
  const hideGround = useStore((s) => s.hideGround);
  const [open, setOpen] = useState(() => !isEmbed() && window.innerWidth > 700); // start folded in embeds and narrow windows
  const basemap = useStore((s) => s.basemap);
  const settings = useStore((s) => s.settings);
  const mapOpt = (k: keyof typeof settings.map) => setShared({ settings: { ...settings, map: { ...settings.map, [k]: !settings.map[k] } } });
  const toggle = (k: keyof Layers) => setShared({ layers: { ...layers, [k]: !layers[k] } });

  return (
    <div className={`overlay layer-panel ${open ? '' : 'closed'}`}>
      <button className="overlay-head" onClick={() => setOpen(!open)}>
        LAYERS <span>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="overlay-body">
          <div className="sub">Map</div>
          <div className="seg small">
            <button className={basemap === 'dark' ? 'on' : ''} onClick={() => setState({ basemap: 'dark' })}>Tactical</button>
            <button className={basemap === 'satellite' ? 'on' : ''} onClick={() => setState({ basemap: 'satellite' })}>Satellite</button>
          </div>
          <div className="chips">
            <button className={settings.map.hillshade ? 'on' : ''} onClick={() => mapOpt('hillshade')}>Relief</button>
            <button className={settings.map.contours ? 'on' : ''} onClick={() => mapOpt('contours')}>Contours</button>
            <button className={settings.map.terrain3d ? 'on' : ''} onClick={() => mapOpt('terrain3d')}>3D</button>
          </div>
          <div className="sub">Layers</div>
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
