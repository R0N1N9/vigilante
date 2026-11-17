import { centroid } from '../../lib/areas';
import { getJsonRetry } from '../../lib/http';
import type { LonLat } from '../../lib/geo';
import { getPack } from '../../lib/packs';
import { parseTfrs, TFR_LIST_URL, TFR_WFS_URL, type Tfr } from '../../lib/tfr';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log, removeIncidents, upsertIncident } from './core';

const TFR_MS = 10 * 60_000;

const tfrCenter = (t: Tfr): LonLat => centroid((t.geometry.type === 'Polygon' ? t.geometry.coordinates[0] : t.geometry.coordinates[0][0]) as LonLat[]);

export function startTfr(gen: number) {
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      const [wfs, list] = await Promise.all([getJsonRetry<{ features: never[] }>(TFR_WFS_URL), getJsonRetry<never[]>(TFR_LIST_URL).catch(() => [])]);
      if (!alive(gen)) return;
      const tfrs = parseTfrs(wfs, list, pack.center, pack.radiusNm + 10);
      const known = new Set(getState().tfrs.map((t) => t.id));
      for (const t of tfrs) {
        upsertIncident({ id: `tfr:${t.id}`, kind: 'tfr', severity: 1, title: `No-fly zone: ${t.type.toLowerCase()}`, detail: t.description || t.title, at: Date.now(), location: tfrCenter(t), url: t.url }, false);
        if (!known.has(t.id)) {
          if (!first) log(`TFR    New no-fly zone ${t.id}: ${t.description || t.title}`, 2);
          emitSignal({ id: `tfr:${t.id}`, source: 'tfr', kind: 'tfr', title: `No-fly zone ${t.id} (${t.type.toLowerCase()})`, detail: t.description || t.title, severity: 2, at: Date.now(), location: tfrCenter(t), url: t.url, packId: ctx.packId }, { quiet: first, regional: true });
        }
      }
      const live = new Set(tfrs.map((t) => `tfr:${t.id}`));
      removeIncidents((i) => i.kind === 'tfr' && !live.has(i.id));
      setState({ tfrs });
      setFeed('tfr', { status: 'live', at: Date.now() });
      first = false;
    } catch (e) {
      setFeed('tfr', { status: 'error', at: getState().feeds.tfr.at, error: String(e) });
    }
    publishData();
  }, TFR_MS);
}
