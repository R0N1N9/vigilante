/** The console (and pop-out windows): store, data engine and the full UI. Loaded only off the phone page. */
import { deviceLocation } from './lib/locate';
import { createRoot } from 'react-dom/client';
import { startBus } from './data/bus';
import { getState, hasChosenCity, setState, subscribe } from './data/store';
import { parseEmbed } from './lib/embed';
import { packForCoords } from './lib/embedPack';
import { storeRead, storeWrite } from './lib/http';
import { nearestPack, packForTimezone, registerPacks, type CityPack } from './lib/packs';
import { DEFAULT_SETTINGS } from './lib/settings';
import { withTheme } from './lib/theme';
import { startEngine } from './data/engine';

import { App } from './ui/App';
import { POPOUT_VIEWS, type View } from './ui/popout';

export function boot(param: string | null) {
  // Web embeds: embed.html or ?embed=1, with ?view=dashboard|map, ?city= and ?theme=.
  const opts = parseEmbed(location.search, location.pathname);
  // Embeds are always a self-contained leader window; ?view= picks the main view instead of a pop-out.
  const view: View = !opts.embed && (POPOUT_VIEWS.some((v) => v.view === param) || param === 'areas') ? (param as View) : 'console';
  const isLeader = view === 'console';

  // Team invites (#join=...) open the Team tab, which embeds don't have: hand a top-level embed page to the full app, hash intact.
  if (opts.embed && /#join=VG1\./.test(location.hash) && window.top === window) {
    location.replace(`${import.meta.env.BASE_URL}${location.hash}`);
    return;
  }

  if (opts.embed) {
    document.documentElement.classList.add('embed');
    setState({ mainView: opts.view ?? 'dashboard' });
  }
  // Show the requested theme right away instead of flashing the default while settings load.
  if (opts.theme && isLeader) setState({ settings: { ...DEFAULT_SETTINGS, appearance: withTheme(DEFAULT_SETTINGS.appearance, opts.theme) } });

  // Keep the custom-location registry in sync in every window.
  let knownLocations = getState().locations;
  subscribe(() => {
    const l = getState().locations;
    if (l !== knownLocations) {
      knownLocations = l;
      registerPacks(l);
    }
  });

  /** First launch: the built-in city nearest the device, else the one in this time zone, else Denver. */
  async function nearestCity() {
    try {
      // An unanswered permission prompt never times out on its own: don't hold the app's start for it.
      const at = await Promise.race([deviceLocation(6000), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no answer')), 8000))]);
      return nearestPack(at);
    } catch {
      return packForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }

  /** ?city= picks the watch location before the sources start, so nothing polls the wrong city first. */
  async function start() {
    const city = opts.city;
    if (city?.kind === 'pack') setState({ packId: city.id });
    else if (!city && !hasChosenCity()) setState({ packId: (await nearestCity()).id });
    else if (city?.kind === 'coords') {
      const p = await packForCoords(city.at);
      const saved = (await storeRead<CityPack[]>('locations')) ?? [];
      await storeWrite('locations', [p, ...saved.filter((l) => l.id !== p.id)].slice(0, 12));
      setState({ packId: p.id });
    }
    await startEngine({ theme: opts.theme });
  }

  startBus(isLeader);
  if (isLeader) void start();

  createRoot(document.getElementById('root')!).render(<App view={view} embed={opts.embed} />);
}
