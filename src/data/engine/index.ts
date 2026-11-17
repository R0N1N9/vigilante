import { withDefaults, type Settings } from '../../lib/settings';
import type { WatchArea } from '../../lib/areas';
import { storeRead, storeWrite } from '../../lib/http';
import { getPack } from '../../lib/packs';
import { publishData, setShared } from '../bus';
import { EMPTY_DATA, getState, setState, subscribe } from '../store';
import { makeBrief, startBriefScheduler } from './brief';
import { startAdsb } from './adsb';
import { clearTimers, ctx, loadHistory, log, recomputeClusters, resetForPack, sendTestPush } from './core';
import { resetDrones, simulateDrone, startDrones } from './drones';
import { startNews } from './news';
import { startNws } from './nws';
import { startTfr } from './tfr';
import { startTraffic } from './traffic';

function startForPack(id: string) {
  clearTimers();
  ctx.packId = id;
  const gen = ++ctx.gen;
  resetForPack();
  resetDrones();
  setState({ ...EMPTY_DATA, feeds: { ...EMPTY_DATA.feeds, drones: getState().feeds.drones }, selectedHex: null });
  const p = getPack(id);
  log(`SYSTEM Watching ${p.name}, ${p.region} (${p.radiusNm} nm radius)`);
  startAdsb(gen);
  startNws(gen);
  startTfr(gen);
  startTraffic(gen);
  startNews(gen);
  recomputeClusters(false);
  publishData();
}

/** Leader window only: load saved state, start all sources, and react to changes. */
export async function startEngine() {
  const [settings, areas] = await Promise.all([storeRead<Partial<Settings>>('settings'), storeRead<WatchArea[]>('areas'), loadHistory()]);
  setShared({ settings: withDefaults(settings), areas: areas ?? [] });

  startForPack(getState().packId);
  startDrones();
  startBriefScheduler();
  window.setInterval(() => recomputeClusters(false), 60_000);

  let prev = getState();
  subscribe(() => {
    const s = getState();
    const p = prev;
    prev = s; // update first: the actions below change state and re-enter this listener
    if (s.settings !== p.settings) void storeWrite('settings', s.settings);
    if (s.areas !== p.areas) void storeWrite('areas', s.areas);
    const r = s.requests;
    if (r.brief && r.brief !== p.requests.brief) makeBrief();
    if (r.pushTest && r.pushTest !== p.requests.pushTest) void sendTestPush();
    if (r.droneSim && r.droneSim !== p.requests.droneSim) simulateDrone();
    if (s.packId !== ctx.packId) startForPack(s.packId);
    else if (s.settings.keys !== p.settings.keys) startForPack(s.packId); // new API key: restart sources
  });
}
