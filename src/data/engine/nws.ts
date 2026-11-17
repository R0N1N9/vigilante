import { getJson, getJsonRetry } from '../../lib/http';
import { alertsUrl, parseAlerts, samplePoints, severityRank, type NwsAlert, type NwsCollection } from '../../lib/nws';
import { getPack } from '../../lib/packs';
import type { Severity } from '../../lib/signals';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log, removeIncidents, upsertIncident } from './core';

const NWS_MS = 120_000;
const zoneCache = new Map<string, GeoJSON.Geometry | null>();
const SEV: Record<string, Severity> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 1 };

async function zoneGeometry(url: string): Promise<GeoJSON.Geometry | null> {
  if (zoneCache.has(url)) return zoneCache.get(url) ?? null;
  try {
    const z = await getJson<{ geometry: GeoJSON.Geometry | null }>(url);
    zoneCache.set(url, z.geometry);
    return z.geometry;
  } catch {
    zoneCache.set(url, null);
    return null;
  }
}

/** Alerts without their own polygon are drawn from their affected zones. */
async function fillGeometry(a: NwsAlert): Promise<NwsAlert> {
  if (a.geometry) return a;
  const geoms = (await Promise.all(a.affectedZones.slice(0, 12).map(zoneGeometry))).filter(
    (g): g is GeoJSON.Polygon | GeoJSON.MultiPolygon => g?.type === 'Polygon' || g?.type === 'MultiPolygon',
  );
  if (!geoms.length) return a;
  const coordinates = geoms.flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates));
  return { ...a, geometry: { type: 'MultiPolygon', coordinates } };
}

export function startNws(gen: number) {
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      const cols = await Promise.all(samplePoints(pack.center, pack.radiusNm).map((p) => getJsonRetry<NwsCollection>(alertsUrl(p))));
      const alerts = await Promise.all(parseAlerts(cols).map(fillGeometry));
      if (!alive(gen)) return;
      const known = new Set(getState().alerts.map((a) => a.id));
      for (const a of alerts) {
        const sev = SEV[a.severity] ?? 1;
        upsertIncident({ id: `wx:${a.id}`, kind: 'weather', severity: sev, title: a.event, detail: a.areaDesc, at: Date.parse(a.sent) || Date.now(), location: null, alertId: a.id }, !first && severityRank(a.severity) >= 3);
        if (!known.has(a.id)) {
          if (!first) log(`NWS    ${a.event}: ${a.areaDesc.slice(0, 90)}`, sev);
          emitSignal({ id: `nws:${a.id}`, source: 'nws', kind: 'alert', title: a.event, detail: a.headline, severity: sev, at: Date.parse(a.sent) || Date.now(), location: null, packId: ctx.packId }, { quiet: first, regional: true });
        }
      }
      const live = new Set(alerts.map((a) => `wx:${a.id}`));
      removeIncidents((i) => i.kind === 'weather' && !live.has(i.id));
      setState({ alerts });
      setFeed('nws', { status: 'live', at: Date.now() });
      first = false;
    } catch (e) {
      setFeed('nws', { status: 'error', at: getState().feeds.nws.at, error: String(e) });
    }
    publishData();
  }, NWS_MS);
}
