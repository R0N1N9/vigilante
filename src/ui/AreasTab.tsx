import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { AREA_COLORS, centroid } from '../lib/areas';
import { MonitorsPanel } from './MonitorsPanel';

export function AreasTab() {
  const areas = useStore((s) => s.areas);
  const packId = useStore((s) => s.packId);
  const drawing = useStore((s) => s.drawing);
  const mine = areas.filter((a) => a.packId === packId);

  const update = (id: string, patch: Partial<(typeof areas)[number]>) => setShared({ areas: getState().areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  return (
    <div className="list">
      <div className="callout">
        <b>Watch areas</b>
        <p>Draw your street, your kid's school, your commute. Anything inside a watch area is treated as one step more urgent, and phone alerts can be limited to them.</p>
        <button className="btn" disabled={!!drawing} onClick={() => setState({ drawing: [], tab: 'areas' })}>
          ✎ Draw a new area
        </button>
      </div>
      {mine.map((a) => (
        <article key={a.id} className="area-row">
          <i className="swatch" style={{ background: a.color }} />
          <input className="area-name" value={a.name} onChange={(e) => update(a.id, { name: e.target.value })} aria-label="Area name" />
          <label className="check small-text" title="Phone alerts for this area">
            <input type="checkbox" checked={a.alerts} onChange={() => update(a.id, { alerts: !a.alerts })} /> alerts
          </label>
          <button className="btn small" onClick={() => setShared({ focus: { at: Date.now(), center: centroid(a.polygon), zoom: 14 } })}>
            Show
          </button>
          <button className="x" title="Delete" onClick={() => confirm(`Delete "${a.name}"?`) && setShared({ areas: getState().areas.filter((x) => x.id !== a.id) })}>
            ×
          </button>
        </article>
      ))}
      {!mine.length && <div className="empty">No watch areas for this city yet.</div>}
      <MonitorsPanel />
    </div>
  );
}

/** Instructions + finish/cancel while drawing on the map. */
export function DrawBar() {
  const drawing = useStore((s) => s.drawing);
  if (!drawing) return null;
  const finish = () => {
    const s = getState();
    if ((s.drawing?.length ?? 0) < 3) return;
    const n = s.areas.filter((a) => a.packId === s.packId).length;
    setShared({
      areas: [...s.areas, { id: Math.random().toString(36).slice(2, 10), name: `Area ${n + 1}`, packId: s.packId, polygon: s.drawing!, alerts: true, color: AREA_COLORS[n % AREA_COLORS.length] }],
    });
    setState({ drawing: null, tab: 'areas' });
  };
  return (
    <div className="overlay draw-bar">
      <span>
        Click the map to add corners ({drawing.length} so far). {drawing.length >= 3 ? 'Finish when done.' : 'At least 3 needed.'}
      </span>
      <button className="btn small" disabled={!drawing.length} onClick={() => setState({ drawing: drawing.slice(0, -1) })}>
        Undo
      </button>
      <button className="btn small primary" disabled={drawing.length < 3} onClick={finish}>
        Finish
      </button>
      <button className="btn small" onClick={() => setState({ drawing: null })}>
        Cancel
      </button>
    </div>
  );
}
