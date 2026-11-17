import { getJsonRetry } from '../../lib/http';
import { getPack } from '../../lib/packs';
import { cotripIncidentsUrl, ga511Url, parseCotripIncidents, parseGa511Cameras, parseGa511Events, type TrafficEvent } from '../../lib/traffic';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, emitSignal, every, log } from './core';

const EVENTS_MS = 2 * 60_000;
const CAMERAS_MS = 60 * 60_000;

function report(events: TrafficEvent[], first: boolean) {
  const known = new Set(getState().traffic.map((t) => t.id));
  for (const e of events) {
    if (known.has(e.id) || e.severity < 2) continue;
    if (!first) log(`ROADS  ${e.title}: ${e.description.slice(0, 90)}`, e.severity);
    emitSignal({ id: `traffic:${e.id}`, source: 'traffic', kind: e.fullClosure ? 'closure' : e.type, title: e.title, detail: e.description, severity: e.severity, at: e.updated || Date.now(), location: e.location, packId: ctx.packId }, { quiet: first });
  }
}

export function startTraffic(gen: number) {
  const pack = getPack(ctx.packId);
  if (pack.traffic.provider === 'none') {
    setFeed('traffic', { status: 'off', at: 0, error: 'No road-incident source for this state yet' });
    publishData();
    return;
  }
  const key = pack.traffic.provider === 'ga511' ? getState().settings.keys.ga511 : getState().settings.keys.cotrip;
  if (!key) {
    setFeed('traffic', { status: 'off', at: 0, error: `Add a free ${pack.traffic.provider === 'ga511' ? 'Georgia 511' : 'COtrip'} key in Settings` });
    publishData();
    return;
  }
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    try {
      const events =
        pack.traffic.provider === 'ga511'
          ? parseGa511Events(await getJsonRetry(ga511Url('event', key)), pack.center, pack.radiusNm)
          : parseCotripIncidents(await getJsonRetry(cotripIncidentsUrl(key)), pack.center, pack.radiusNm);
      if (!alive(gen)) return;
      report(events, first);
      first = false;
      setState({ traffic: events.sort((a, b) => b.severity - a.severity || b.updated - a.updated) });
      setFeed('traffic', { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed('traffic', { status: 'error', at: getState().feeds.traffic.at, error: String(e) });
    }
    publishData();
  }, EVENTS_MS);

  if (pack.traffic.provider === 'ga511') {
    every(async () => {
      if (!alive(gen)) return;
      try {
        const cameras = parseGa511Cameras(await getJsonRetry(ga511Url('cameras', key)), pack.center, pack.radiusNm);
        if (alive(gen)) setState({ cameras });
      } catch (e) {
        log(`ROADS  Camera list failed: ${String(e)}`, 1);
      }
      publishData();
    }, CAMERAS_MS);
  }
}
