import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { startBus } from './data/bus';
import { getState, setState, subscribe } from './data/store';
import { parseEmbed } from './lib/embed';
import { packForCoords } from './lib/embedPack';
import { storeRead, storeWrite } from './lib/http';
import { registerPacks, type CityPack } from './lib/packs';
import { DEFAULT_SETTINGS } from './lib/settings';
import { withTheme } from './lib/theme';
import { startEngine } from './data/engine';

import { App } from './ui/App';
import { POPOUT_VIEWS, type View } from './ui/popout';

const opts = parseEmbed(location.search, location.pathname);
const param = new URLSearchParams(location.search).get('view');
// Embeds are always a self-contained leader window; ?view= picks the main view instead of a pop-out.
const view: View = !opts.embed && (POPOUT_VIEWS.some((v) => v.view === param) || param === 'areas') ? (param as View) : 'console';
const isLeader = view === 'console';

// Team invites (#join=...) open the Team tab, which embeds don't have: hand a top-level embed page to the full app, hash intact.
if (opts.embed && /#join=VG1\./.test(location.hash) && window.top === window) location.replace(`${import.meta.env.BASE_URL}${location.hash}`);

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

/** ?city= picks the watch location before the sources start, so nothing polls the wrong city first. */
async function boot() {
  const city = opts.city;
  if (city?.kind === 'pack') setState({ packId: city.id });
  else if (city?.kind === 'coords') {
    const p = await packForCoords(city.at);
    const saved = (await storeRead<CityPack[]>('locations')) ?? [];
    await storeWrite('locations', [p, ...saved.filter((l) => l.id !== p.id)].slice(0, 12));
    setState({ packId: p.id });
  }
  await startEngine({ theme: opts.theme });
}

startBus(isLeader);
if (isLeader) void boot();

createRoot(document.getElementById('root')!).render(<App view={view} embed={opts.embed} />);
