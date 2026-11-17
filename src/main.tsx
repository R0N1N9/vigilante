import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { startBus } from './data/bus';
import { getState, subscribe } from './data/store';
import { registerPacks } from './lib/packs';
import { startEngine } from './data/engine';

import { App } from './ui/App';
import { POPOUT_VIEWS, type View } from './ui/popout';

const param = new URLSearchParams(location.search).get('view');

// Phone check-in page: a light standalone view with no data engine.
if (param === 'field') {
  void import('./ui/FieldApp').then(({ FieldApp }) => createRoot(document.getElementById('root')!).render(<FieldApp />));
} else boot();

function boot() {
  const view: View = POPOUT_VIEWS.some((v) => v.view === param) || param === 'areas' ? (param as View) : 'console';
  const isLeader = view === 'console';

  // Keep the custom-location registry in sync in every window.
  let knownLocations = getState().locations;
  subscribe(() => {
    const l = getState().locations;
    if (l !== knownLocations) {
      knownLocations = l;
      registerPacks(l);
    }
  });

  startBus(isLeader);
  if (isLeader) void startEngine();

  createRoot(document.getElementById('root')!).render(<App view={view} />);
}
