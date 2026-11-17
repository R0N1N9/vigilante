import { getBytesRetry, storeRead, storeWrite } from '../../lib/http';
import { parseGtfsZip, type GtfsLite } from '../../lib/gtfs';
import { decodeAlerts, decodeTripUpdates, decodeVehicles } from '../../lib/gtfsrt';
import { getPack } from '../../lib/packs';
import { martaDisruptions, rtdDisruptions, type TransitDisruption } from '../../lib/transit';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log } from './core';

const POLL_MS = 2 * 60_000;
const STATIC_MAX_AGE = 7 * 24 * 3600_000;

/** Stop locations and route names from the agency's static GTFS, cached for a week. */
async function loadStatic(agency: string, url: string): Promise<GtfsLite | null> {
  const name = `gtfs-${agency.toLowerCase()}`;
  const cached = await storeRead<GtfsLite>(name);
  if (cached && Date.now() - cached.fetchedAt < STATIC_MAX_AGE) return cached;
  try {
    const g = parseGtfsZip(await getBytesRetry(url, 2, 2000));
    void storeWrite(name, g);
    return g;
  } catch (e) {
    log(`TRANSIT ${agency} schedule download failed (${String(e)}); alerts will lack locations`, 1);
    return cached;
  }
}

function report(list: TransitDisruption[], first: boolean) {
  const known = new Set(getState().transit.map((t) => t.id));
  for (const d of list) {
    if (known.has(d.id) || d.severity < 1) continue;
    if (!first) log(`TRANSIT ${d.agency} ${d.title}: ${d.detail.slice(0, 90)}`, d.severity);
    emitSignal(
      { id: `transit:${d.id}:${new Date().toDateString()}`, source: 'transit', kind: d.cause || d.effect || 'disruption', title: `${d.agency} ${d.title}${d.cause ? ` (${d.cause.toLowerCase()})` : ''}`, detail: d.detail, severity: d.severity, at: Date.now(), location: d.location, packId: ctx.packId },
      { quiet: first },
    );
  }
}

export function startTransit(gen: number) {
  const t = getPack(ctx.packId).transit;
  if (!t) {
    setFeed('transit', { status: 'off', at: 0, error: 'No transit feed set up for this area yet' });
    publishData();
    return;
  }
  let staticData: GtfsLite | null = null;
  let staticLoading: Promise<void> | null = null;
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      staticLoading ??= loadStatic(t.agency, t.staticUrl).then((g) => void (staticData = g));
      await staticLoading;
      let list: TransitDisruption[];
      if (t.agency === 'RTD') {
        list = rtdDisruptions(decodeAlerts(await getBytesRetry(t.alertsUrl)), staticData, pack.center, pack.radiusNm, Date.now() / 1000);
      } else {
        const [tu, vp] = await Promise.all([getBytesRetry(t.tripUpdatesUrl), getBytesRetry(t.vehiclesUrl)]);
        list = martaDisruptions(decodeTripUpdates(tu), decodeVehicles(vp), staticData, pack.center, pack.radiusNm);
      }
      if (!alive(gen)) return;
      report(list, first);
      first = false;
      setState({ transit: list });
      setFeed('transit', { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed('transit', { status: 'error', at: getState().feeds.transit.at, error: String(e) });
    }
    publishData();
  }, POLL_MS);
}
