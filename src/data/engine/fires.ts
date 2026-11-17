import { parseWfigs, wfigsQuery } from '../../lib/fires';
import { getJsonRetry } from '../../lib/http';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log, removeIncidents, upsertIncident } from './core';

const POLL_MS = 10 * 60_000;
/** Wildfires are watched well beyond the city: smoke and evacuations travel. */
const FIRE_RADIUS_NM = 75;

export function startFires(gen: number) {
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      const fires = parseWfigs(await getJsonRetry(wfigsQuery(pack.center, FIRE_RADIUS_NM)), pack.center).filter((f) => f.distNm <= FIRE_RADIUS_NM);
      if (!alive(gen)) return;
      const known = new Set(getState().fires.map((f) => f.id));
      for (const f of fires) {
        const acres = f.acres != null ? `${Math.round(f.acres).toLocaleString('en-US')} acres` : 'size unknown';
        const detail = `${acres}${f.containedPct != null ? `, ${f.containedPct}% contained` : ''} · ${Math.round(f.distNm)} nm away${f.county ? ` (${f.county} County)` : ''}`;
        if (f.severity >= 1) upsertIncident({ id: `fire:${f.id}`, kind: 'fire', severity: f.severity, title: `Wildfire: ${f.name}`, detail, at: f.discovered ?? Date.now(), location: f.location }, !first && !known.has(f.id));
        if (known.has(f.id)) continue;
        if (!first && f.kind !== 'other') log(`FIRE   ${f.kind === 'prescribed' ? 'Prescribed burn' : 'Wildfire'} ${f.name}: ${detail}`, f.severity);
        if (f.severity >= 1)
          emitSignal({ id: `fire:${f.id}`, source: 'fire', kind: f.kind, title: `Wildfire: ${f.name}`, detail, severity: f.severity, at: f.discovered ?? Date.now(), location: f.location, packId: ctx.packId }, { quiet: first });
      }
      const live = new Set(fires.map((f) => `fire:${f.id}`));
      removeIncidents((i) => i.kind === 'fire' && !live.has(i.id));
      first = false;
      setState({ fires });
      setFeed('fire', { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed('fire', { status: 'error', at: getState().feeds.fire.at, error: String(e) });
    }
    publishData();
  }, POLL_MS);
}
