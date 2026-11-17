import { useMemo, useState } from 'react';
import { setShared } from '../data/bus';
import { useStore } from '../data/store';
import { passesCeiling, type Aircraft } from '../lib/adsb';
import { CLASS_COLORS } from '../map/icons';
import { Icon } from './Icon';

type Filter = 'all' | 'heli' | 'low' | 'mil';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'heli', label: 'Helos' },
  { id: 'low', label: 'Low' },
  { id: 'mil', label: 'Military' },
];

const RANK = { emergency: 0, heli: 1, military: 2, low: 3, normal: 4 };

export function AircraftList() {
  const aircraft = useStore((s) => s.aircraft);
  const selected = useStore((s) => s.selectedHex);
  const ceiling = useStore((s) => s.ceilingAglFt);
  const hideGround = useStore((s) => s.hideGround);
  const orbiting = useStore((s) => s.orbiting);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const pass = (a: Aircraft) =>
      filter === 'heli' ? a.kind === 'heli' : filter === 'low' ? a.cls === 'low' || a.kind === 'heli' : filter === 'mil' ? a.military : true;
    return aircraft
      .filter((a) => passesCeiling(a, ceiling, hideGround) && pass(a))
      .sort((a, b) => RANK[a.cls] - RANK[b.cls] || (orbiting[b.hex] ? 1 : 0) - (orbiting[a.hex] ? 1 : 0) || a.distNm - b.distNm);
  }, [aircraft, filter, ceiling, hideGround, orbiting]);

  return (
    <section className="panel grow">
      <div className="panel-head">
        <span className="count mono">{rows.length} aircraft</span>
        <div className="seg small">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="ac-table mono">
          <thead>
            <tr>
              <th />
              <th>CALLSIGN</th>
              <th>TYPE</th>
              <th className="r">ALT</th>
              <th className="r">KT</th>
              <th className="r">NM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.hex}
                className={a.hex === selected ? 'sel' : ''}
                onClick={() => setShared({ selectedHex: a.hex, focus: { at: Date.now(), center: [a.lon, a.lat] } })}
              >
                <td>
                  <i className="dot" style={{ background: CLASS_COLORS[a.cls] }} />
                </td>
                <td>
                  {a.callsign}
                  {orbiting[a.hex] && <span className="orbit-badge"><Icon name="orbit" size={12} /></span>}
                </td>
                <td className="muted">{a.type || '—'}</td>
                <td className="r">{a.onGround ? 'GND' : a.altFt == null ? '—' : Math.round(a.altFt / 100).toString().padStart(3, '0')}</td>
                <td className="r">{a.gsKt == null ? '—' : Math.round(a.gsKt)}</td>
                <td className="r">{a.distNm.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No aircraft match.</div>}
      </div>
    </section>
  );
}
