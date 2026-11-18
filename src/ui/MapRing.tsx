/**
 * Press-and-hold ring menu for the map (the same gesture as Vigil):
 * hold the map (mouse or finger) and options fan out around the spot; slide
 * onto one and let go to pick it, or let go in the middle and click/tap one.
 * Right-click opens the same ring. Esc, a click outside, or the middle closes it.
 */
import { useEffect, useRef, useState } from 'react';
import { sendMark } from '../data/engine/comms';
import { setShared } from '../data/bus';
import { getState, setState } from '../data/store';
import { newMonitor } from '../lib/monitors';
import { directionsLinks } from '../lib/waypoints';
import { Icon, type IconName } from './Icon';
import { newMarkAt, newReconAt } from './Marks';
import { newPhoto } from './Photos';
import { openExternal } from './popout';
import { placeWaypoint } from './Waypoints';

export interface RingAt {
  /** Pixel position inside the map container, and the map coordinate. */
  x: number;
  y: number;
  at: [number, number];
  /** 'hold': follows the pointer until release; 'open': waits for a click. */
  mode: 'hold' | 'open';
  /** 'ring' (press and hold) or 'list' (right-click: a rectangular menu at the cursor). */
  shape?: 'ring' | 'list';
}

interface Opt {
  id: string;
  label: string;
  icon: IconName;
  color: string;
  team?: boolean;
}

const OPTS: Opt[] = [
  { id: 'ping', label: 'Ping', icon: 'target', color: '#3DD6F5', team: true },
  { id: 'mark', label: 'Mark', icon: 'pin', color: '#E6EDF3', team: true },
  { id: 'recon', label: 'Recon', icon: 'camera', color: '#A78BFA', team: true },
  { id: 'waypoint', label: 'Waypoint', icon: 'locate', color: '#2BD47D', team: true },
  { id: 'backup', label: 'Backup', icon: 'warning', color: '#FF9F1C', team: true },
  { id: 'photo', label: 'Photo', icon: 'camera', color: '#FFD84D', team: true },
  { id: 'go', label: 'Go', icon: 'external', color: '#9FB3C8' },
  { id: 'info', label: 'Info', icon: 'share', color: '#9FB3C8' },
  { id: 'zone', label: 'Zone', icon: 'ring', color: '#C084FC' },
  { id: 'radio', label: 'Radio', icon: 'radio', color: '#FFD84D' },
];

const R = 96; // ring radius
const B = 26; // half a button

let setRingExternal: ((r: RingAt | null) => void) | null = null;
let currentRing: RingAt | null = null;
/** Moves during a hold report the pointer position (container pixels) so the ring can highlight. */
let onMove: ((x: number, y: number, buttons?: number) => void) | null = null;
let onRelease: ((x: number, y: number) => void) | null = null;
/** Called whenever the ring closes or stops following the pointer (MapView re-enables map dragging). */
let onSettle: (() => void) | null = null;
export const setRingSettle = (f: (() => void) | null) => void (onSettle = f);

export const ringOpen = () => !!currentRing;
export const openRing = (r: RingAt) => setRingExternal?.(r);
export const closeRing = () => setRingExternal?.(null);
export const ringMove = (x: number, y: number, buttons?: number) => onMove?.(x, y, buttons);
export const ringRelease = (x: number, y: number) => onRelease?.(x, y);

function hasTeam() {
  return getState().channels.some((c) => c.kind === 'ntfy' && c.enabled && c.posKey);
}

export function runRingOption(id: string, at: [number, number], showInfo: (at: [number, number]) => void) {
  const [lon, lat] = at;
  const s = getState();
  // Team actions need a team channel: open Deploy, which creates one in a tap, instead of doing nothing.
  if (OPTS.find((o) => o.id === id)?.team && !hasTeam()) return setState({ modal: 'deploy' });
  switch (id) {
    case 'ping': {
      const ch = s.channels.find((c) => c.kind === 'ntfy' && c.enabled && c.posKey);
      if (!ch) return newMarkAt(at, 'ping');
      void sendMark({ id: Math.random().toString(36).slice(2, 10), channelId: ch.id, kind: 'ping', cat: 'general', name: 'Ping', desc: '', location: at, state: 'active', by: s.settings.team.callsign || 'Ops', byId: s.settings.team.installId, at: Date.now(), ttlS: 900 }).catch(() => newMarkAt(at, 'ping'));
      return;
    }
    case 'mark':
      return newMarkAt(at, 'marker');
    case 'recon':
      return newReconAt(at);
    case 'waypoint':
      return placeWaypoint(at);
    case 'backup':
      return placeWaypoint(at, { name: 'Backup needed here', note: 'Respond to this location.', urgent: true });
    case 'photo':
      return newPhoto({ at });
    case 'go':
      return void openExternal(directionsLinks(lat, lon, 'Pinned spot').google, 'Directions');
    case 'info':
      return showInfo(at);
    case 'zone': {
      const m = newMonitor('proximity', { name: `Zone ${lat.toFixed(3)}, ${lon.toFixed(3)}`, center: at, radiusM: 500, minSeverity: 1 });
      setShared({ monitors: [m, ...s.monitors] });
      setState({ tab: 'areas' });
      return;
    }
    case 'radio':
      setShared({ focus: { at: Date.now(), center: at, zoom: Math.max(10, 11), label: 'Radio coverage' } });
      setState({ tab: 'radio', layers: { ...s.layers, radio: true } });
      return;
  }
}

/** The ring overlay. `size` is the map container's size, used to keep the ring on screen. */
export function MapRing({ size, showInfo }: { size: { w: number; h: number }; showInfo: (at: [number, number]) => void }) {
  const [ring, setRing] = useState<RingAt | null>(null);
  const [hot, setHot] = useState(-1);
  const hotRef = useRef(-1);
  useEffect(() => {
    setRingExternal = (r) => {
      if (!r || r.mode !== 'hold') onSettle?.();
      currentRing = r;
      setRing(r);
      setHot(-1);
      hotRef.current = -1;
    };
    return () => {
      setRingExternal = null;
      currentRing = null;
    };
  }, []);

  const team = hasTeam();
  const opts = OPTS;
  // Keep the whole ring inside the map; the pressed spot itself stays where it is.
  const cx = ring ? Math.min(Math.max(ring.x, R + B + 6), Math.max(R + B + 6, size.w - R - B - 6)) : 0;
  const cy = ring ? Math.min(Math.max(ring.y, R + B + 6), Math.max(R + B + 6, size.h - R - B - 30)) : 0;
  const pos = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / opts.length;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  };
  const pick = (i: number) => {
    const o = opts[i];
    if (!o || !ring) return;
    const at = ring.at;
    setRingExternal?.(null);
    navigator.vibrate?.(15);
    runRingOption(o.id, at, showInfo);
  };
  const hitTest = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    if (Math.hypot(dx, dy) < 36) return -1;
    let best = -1;
    let bd = Infinity;
    opts.forEach((_, i) => {
      const p = pos(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return bd < B + 30 ? best : -1;
  };
  onMove = (x, y, buttons?: number) => {
    if (!ring) return;
    if (ring.mode === 'hold' && buttons === 0) return onRelease?.(x, y);
    const h = hitTest(x, y);
    if (h !== hotRef.current) {
      hotRef.current = h;
      setHot(h);
      if (h >= 0) navigator.vibrate?.(8);
    }
  };
  onRelease = (x, y) => {
    if (!ring || ring.mode !== 'hold') return;
    const h = hitTest(x, y);
    if (h >= 0) pick(h);
    else setRingExternal?.({ ...ring, mode: 'open' });
  };

  useEffect(() => {
    if (!ring) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setRingExternal?.(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ring]);

  if (!ring) return null;
  if (ring.shape === 'list') {
    const W = 236;
    const H = 44 + Math.ceil(opts.length / 2) * 42;
    const left = Math.max(6, Math.min(ring.x, size.w - W - 6));
    const top = ring.y + H + 6 > size.h ? Math.max(6, ring.y - H) : ring.y;
    return (
      <div
        className="map-ring open list"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setRingExternal?.(null);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (e.target === e.currentTarget) setRingExternal?.(null);
        }}
      >
        <i className="ring-spot" style={{ left: ring.x, top: ring.y }} />
        <div className="ring-list" style={{ left, top, width: W }} role="menu" aria-label="Map actions">
          <div className="ring-list-head mono">
            {ring.at[1].toFixed(5)}, {ring.at[0].toFixed(5)}
            <button onClick={() => setRingExternal?.(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="ring-list-grid">
            {opts.map((o, i) => (
              <button key={o.id} role="menuitem" className={`ring-item ${o.team && !team ? 'needs-team' : ''}`} style={{ ['--c' as string]: o.color }} onClick={() => pick(i)}>
                <Icon name={o.icon} size={15} />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          {!team && <p className="ring-list-note">Team actions open Deploy to set up a team first.</p>}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`map-ring ${ring.mode}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setRingExternal?.(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <i className="ring-spot" style={{ left: ring.x, top: ring.y }} />
      <div className="ring-disc" style={{ left: cx - R - B - 8, top: cy - R - B - 8, width: 2 * (R + B + 8), height: 2 * (R + B + 8) }} />
      <button className="ring-center" style={{ left: cx - 22, top: cy - 22 }} onClick={() => setRingExternal?.(null)} aria-label="Close">
        ×
      </button>
      {opts.map((o, i) => {
        const p = pos(i);
        const off = !!o.team && !team;
        return (
          <button
            key={o.id}
            className={`ring-opt ${hot === i ? 'hot' : ''} ${off ? 'off' : ''}`}
            style={{ left: p.x - B, top: p.y - B, color: o.color }}
            aria-label={off ? `${o.label} (sets up a team first)` : o.label}
            onClick={() => pick(i)}
            onPointerEnter={() => setHot(i)}
            onPointerLeave={() => setHot(-1)}
          >
            <Icon name={o.icon} size={18} />
            <span>{o.label}</span>
          </button>
        );
      })}
      <div className="ring-coords mono" style={{ left: cx, top: Math.min(cy + R + B + 14, size.h - 22) }}>
        {ring.at[1].toFixed(5)}, {ring.at[0].toFixed(5)}
        {ring.mode === 'hold' ? ' · slide to an option and let go' : !team ? ' · team actions set up a team first' : ''}
      </div>
    </div>
  );
}
