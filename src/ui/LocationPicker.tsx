import { useEffect, useMemo, useRef, useState } from 'react';
import { setShared } from '../data/bus';
import { getState, useStore } from '../data/store';
import { buildPack, deviceLocation, reverseGeocode, searchPlaces, type GeoResult } from '../lib/locate';
import { getPack, hasLocalSources, PACKS } from '../lib/packs';
import { Icon } from './Icon';

/** Current watch location + search, device location and saved places. */
export function LocationPicker() {
  const packId = useStore((s) => s.packId);
  const locations = useStore((s) => s.locations);
  const pack = getPack(packId);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Built-in cities: those with full local sources first, then A–Z; typing filters them.
  const cities = useMemo(() => {
    const t = q.trim().toLowerCase();
    return PACKS.filter((p) => !t || `${p.name} ${p.region} ${p.power.state}`.toLowerCase().includes(t)).sort((a, b) => Number(hasLocalSources(b)) - Number(hasLocalSources(a)) || a.name.localeCompare(b.name) || a.region.localeCompare(b.region));
  }, [q]);
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const choose = async (g: GeoResult) => {
    setBusy(`Setting up ${g.name}…`);
    setError(null);
    try {
      const p = await buildPack(g);
      const rest = getState().locations.filter((l) => l.id !== p.id);
      setShared({ locations: [p, ...rest].slice(0, 12), packId: p.id });
      setOpen(false);
      setResults(null);
      setQ('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy('Searching…');
    setError(null);
    try {
      const r = await searchPlaces(q);
      setResults(r);
      if (!r.length) setError('No US places found. Try "City, ST" or a ZIP code.');
    } catch (e) {
      setError(`Search failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const useMine = async () => {
    setBusy('Finding your location…');
    setError(null);
    try {
      const at = await deviceLocation();
      await choose(await reverseGeocode(at));
    } catch (e) {
      setError(`${(e as Error).message}. Search for your city instead.`);
      setBusy(null);
    }
  };

  return (
    <div className="menu loc" ref={ref}>
      <button className="loc-btn" onClick={() => setOpen(!open)} title="Change the watched location">
        <span className="loc-dot"><Icon name="target" size={13} /></span>
        <span className="loc-name">
          {pack.name}
          <small>{pack.region}</small>
        </span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="menu-list loc-pop">
          <form
            className="loc-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city, address or ZIP…" aria-label="Search location" />
            <button className="btn small" type="submit" disabled={!!busy}>
              Go
            </button>
          </form>
          <button className="loc-row mine" onClick={() => void useMine()} disabled={!!busy}>
            <Icon name="locate" /> Use my location
          </button>
          {busy && <div className="loc-note">{busy}</div>}
          {error && <div className="loc-note err">{error}</div>}
          {results?.map((r) => (
            <button key={`${r.at}`} className="loc-row" onClick={() => void choose(r)} title={r.label}>
              <b>{r.name}</b>
              <small>{r.label}</small>
            </button>
          ))}
          {locations.length > 0 && <div className="menu-hint">SAVED</div>}
          {locations.map((p) => (
            <div key={p.id} className={`loc-row saved ${p.id === packId ? 'on' : ''}`}>
              <button
                onClick={() => {
                  setShared({ packId: p.id });
                  setOpen(false);
                }}
              >
                <b>{p.name}</b>
                <small>{p.region}</small>
              </button>
              <button
                className="x"
                title="Remove"
                onClick={() => {
                  const rest = getState().locations.filter((l) => l.id !== p.id);
                  setShared({ locations: rest, ...(packId === p.id ? { packId: 'denver' } : {}) });
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="menu-hint">CITIES · {cities.length}</div>
          {cities.map((p) => (
            <div key={p.id} className={`loc-row saved ${p.id === packId ? 'on' : ''}`}>
              <button
                onClick={() => {
                  setShared({ packId: p.id });
                  setOpen(false);
                }}
              >
                <b>{p.name}</b>
                <small>
                  {p.region}
                  {hasLocalSources(p) ? ' · full local sources' : ''}
                </small>
              </button>
            </div>
          ))}
          {!cities.length && <div className="loc-note">No built-in city matches. Press Go to search everywhere.</div>}
          <div className="menu-hint">Search by OpenStreetMap Nominatim</div>
        </div>
      )}
    </div>
  );
}
