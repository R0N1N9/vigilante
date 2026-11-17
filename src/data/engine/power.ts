import { getJsonRetry } from '../../lib/http';
import { odinUrl, parseOdin } from '../../lib/outages';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log } from './core';

const POLL_MS = 10 * 60_000;

export function startPower(gen: number) {
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      const outages = parseOdin(await getJsonRetry(odinUrl(pack.power.state)), pack.center, pack.radiusNm);
      if (!alive(gen)) return;
      const prev = new Map(getState().outages.map((o) => [o.id, o.severity]));
      for (const o of outages) {
        if (o.severity < 1 || (prev.get(o.id) ?? -1) >= o.severity) continue;
        const text = `${o.customers.toLocaleString('en-US')} customers out in ${o.county} County (${o.utilities.join(', ')})`;
        if (!first) log(`POWER  ${text}`, o.severity);
        emitSignal(
          { id: `power:${o.id}:${o.severity}:${new Date().toDateString()}`, source: 'power', kind: 'outage', title: `Power outage, ${o.county} County`, detail: text, severity: o.severity, at: Date.now(), location: null, packId: ctx.packId },
          { quiet: first, regional: true },
        );
      }
      first = false;
      setState({ outages });
      setFeed('power', { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed('power', { status: 'error', at: getState().feeds.power.at, error: String(e) });
    }
    publishData();
  }, POLL_MS);
}
