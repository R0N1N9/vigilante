import { withDefaults, type Settings } from '../../lib/settings';
import { withTheme, type ThemeId } from '../../lib/theme';
import type { WatchArea } from '../../lib/areas';
import { storeRead, storeWrite } from '../../lib/http';
import { getPack, registerPacks, type CityPack } from '../../lib/packs';
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
import { startTransit } from './transit';
import { startPower } from './power';
import { startFires } from './fires';
import { startIntel } from './intel';
import { startShips } from './ships';
import { refreshDashboard, requestAiBrief, resetDashboard } from './dashboard';
import { newMonitor, type Monitor, type MonitorHit } from '../../lib/monitors';
import { resetMonitors, startMonitors } from './monitors';
import { sendTestNotifications } from './notify';

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
  startTransit(gen);
  startPower(gen);
  startFires(gen);
  startIntel(gen);
  startShips(gen);
  startNews(gen);
  resetDashboard();
  resetMonitors();
  recomputeClusters(false);
  publishData();
}

/** Leader window only: load saved state, start all sources, and react to changes. */
export async function startEngine(opts: { theme?: Exclude<ThemeId, 'custom'> | null } = {}) {
  const [saved, areas, locations, monitors, hits] = await Promise.all([storeRead<Partial<Settings>>('settings'), storeRead<WatchArea[]>('areas'), storeRead<CityPack[]>('locations'), storeRead<Monitor[]>('monitors'), storeRead<MonitorHit[]>('hits'), loadHistory()]);
  registerPacks(locations ?? []);
  let settings = withDefaults(saved);
  if (opts.theme) settings = { ...settings, appearance: withTheme(settings.appearance, opts.theme) }; // ?theme= (embeds)
  setShared({ settings, areas: areas ?? [], locations: locations ?? [], monitors: (monitors ?? []).map((m) => ({ ...newMonitor(m.kind), ...m })), hits: hits ?? [] });
  startMonitors();

  startForPack(getState().packId);
  startDrones();
  startBriefScheduler();
  window.setInterval(() => recomputeClusters(false), 60_000);
  window.setTimeout(refreshDashboard, 20_000);
  window.setInterval(refreshDashboard, 60_000);

  let prev = getState();
  subscribe(() => {
    const s = getState();
    const p = prev;
    prev = s; // update first: the actions below change state and re-enter this listener
    const r = s.requests;
    if (s.settings !== p.settings) void storeWrite('settings', s.settings);
    if (s.areas !== p.areas) void storeWrite('areas', s.areas);
    if (s.locations !== p.locations) void storeWrite('locations', s.locations);
    if (s.monitors !== p.monitors) void storeWrite('monitors', s.monitors);
    if (s.hits !== p.hits) void storeWrite('hits', s.hits);
    if (r.notifyTest && r.notifyTest !== p.requests.notifyTest) void sendTestNotifications();
      if (r.brief && r.brief !== p.requests.brief) makeBrief();
    if (r.pushTest && r.pushTest !== p.requests.pushTest) void sendTestPush();
    if (r.droneSim && r.droneSim !== p.requests.droneSim) simulateDrone();
    if (r.ai && r.ai !== p.requests.ai) void requestAiBrief();
    if (s.packId !== ctx.packId) startForPack(s.packId);
    else if (s.settings.keys !== p.settings.keys) startForPack(s.packId); // new API key: restart sources
  });
}
