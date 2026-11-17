import { adsbUrl, normalizeAircraft, type Aircraft, type RawAircraft } from '../../lib/adsb';
import { getJsonRetry } from '../../lib/http';
import { detectOrbit, type TrailPoint } from '../../lib/orbit';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, log, removeIncidents, upsertIncident } from './core';

const ADSB_MS = 5_000;
const ADSB_BACKOFF_MS = 10_000;
const TRAIL_MAX_AGE_MS = 15 * 60_000;
const ORBIT_CLEAR_MS = 3 * 60_000;

export function startAdsb(gen: number) {
  const seenHelis = new Set<string>();
  const orbitStart: Record<string, number> = {};
  const orbitLast: Record<string, number> = {};
  let first = true;

  const poll = async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    let delay = ADSB_MS;
    try {
      const data = await getJsonRetry<{ ac?: RawAircraft[] }>(adsbUrl(pack.center, pack.radiusNm));
      if (!alive(gen)) return;
      const now = Date.now();
      const aircraft = (data.ac ?? [])
        .map((r) => normalizeAircraft(r, pack.center, pack.fieldElevationFt))
        .filter((a): a is Aircraft => a != null && a.seenS < 60);

      const prev = getState().trails;
      const trails: Record<string, TrailPoint[]> = {};
      for (const a of aircraft) {
        const old = (prev[a.hex] ?? []).filter((p) => now - p.t <= TRAIL_MAX_AGE_MS);
        const last = old[old.length - 1];
        const pt: TrailPoint = { lon: a.lon, lat: a.lat, t: now - a.seenS * 1000, track: a.track, alt: a.altFt };
        trails[a.hex] = last && last.lon === pt.lon && last.lat === pt.lat ? old : [...old, pt];
      }

      const orbiting: Record<string, { center: [number, number]; radiusM: number; turns: number }> = {};
      for (const a of aircraft) {
        if (a.onGround) continue;
        const o = detectOrbit(trails[a.hex], now);
        if (!o.orbiting) continue;
        orbiting[a.hex] = { center: o.center, radiusM: o.radiusM, turns: o.turns };
        const isNew = orbitLast[a.hex] == null;
        if (isNew) orbitStart[a.hex] = now;
        orbitLast[a.hex] = now;
        const label = `${a.callsign}${a.type ? ` (${a.type})` : ''}`;
        const sev = a.kind === 'heli' ? 3 : 2;
        upsertIncident(
          { id: `orbit:${a.hex}`, kind: 'orbit', severity: sev, title: `${a.kind === 'heli' ? 'Helicopter' : 'Aircraft'} circling`, detail: `${label} · ${o.turns.toFixed(1)} turns · r≈${(o.radiusM / 1000).toFixed(1)} km`, at: now, location: o.center, hex: a.hex },
          isNew,
        );
        if (isNew) {
          log(`ORBIT  ${label} circling, radius ${(o.radiusM / 1000).toFixed(1)} km`, sev);
          emitSignal({ id: `adsb:orbit:${a.hex}:${orbitStart[a.hex]}`, source: 'adsb', kind: 'orbit', title: `${a.kind === 'heli' ? 'Helicopter' : 'Aircraft'} circling`, detail: `${label} · ${o.turns.toFixed(1)} turns`, severity: sev, at: now, location: o.center, packId: ctx.packId });
        }
      }
      for (const [hex, at] of Object.entries(orbitLast)) {
        if (now - at > ORBIT_CLEAR_MS) {
          delete orbitLast[hex];
          delete orbitStart[hex];
          removeIncidents((i) => i.id === `orbit:${hex}`);
        }
      }

      const emerg = new Set<string>();
      for (const a of aircraft) {
        if (!a.emergency) continue;
        emerg.add(a.hex);
        const id = `squawk:${a.hex}`;
        const isNew = !getState().incidents.some((i) => i.id === id);
        const detail = `${a.callsign}${a.type ? ` (${a.type})` : ''} squawk ${a.squawk} · ${a.altFt ?? '?'} ft`;
        upsertIncident({ id, kind: 'squawk', severity: 4, title: `Emergency: ${a.emergency}`, detail, at: now, location: [a.lon, a.lat], hex: a.hex }, true);
        if (isNew) {
          log(`SQUAWK ${a.squawk} ${a.callsign} ${a.emergency}`, 4);
          emitSignal({ id: `adsb:squawk:${a.hex}:${new Date(now).toDateString()}`, source: 'adsb', kind: 'squawk', title: `Emergency: ${a.emergency}`, detail, severity: 4, at: now, location: [a.lon, a.lat], packId: ctx.packId });
        }
      }
      removeIncidents((i) => i.kind === 'squawk' && !emerg.has(i.hex ?? ''));

      for (const h of aircraft.filter((a) => a.kind === 'heli')) {
        if (!seenHelis.has(h.hex) && !first) {
          log(`HELO   ${h.callsign}${h.type ? ` ${h.type}` : ''} entered area, ${h.distNm.toFixed(1)} nm out, ${h.aglFt ?? '?'} ft AGL`, 1);
          emitSignal({ id: `adsb:heli:${h.hex}:${now}`, source: 'adsb', kind: 'heli', title: 'Helicopter', detail: `${h.callsign}${h.type ? ` (${h.type})` : ''} entered area`, severity: 0, at: now, location: [h.lon, h.lat], packId: ctx.packId }, { quiet: true });
        }
        seenHelis.add(h.hex);
      }
      first = false;

      setState({ aircraft, trails, orbiting });
      setFeed('adsb', { status: 'live', at: now });
    } catch (e) {
      delay = ADSB_BACKOFF_MS;
      const lastOk = getState().feeds.adsb.at;
      setFeed('adsb', { status: lastOk && Date.now() - lastOk < 60_000 ? 'stale' : 'error', at: lastOk, error: String(e) });
    }
    publishData();
    if (alive(gen)) window.setTimeout(poll, delay);
  };
  void poll();
}
