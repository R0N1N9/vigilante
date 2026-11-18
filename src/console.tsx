/** The console (and pop-out windows): store, data engine and the full UI. Loaded only off the phone page. */
import { createRoot } from 'react-dom/client';
import { startBus } from './data/bus';
import { getState, subscribe } from './data/store';
import { registerPacks } from './lib/packs';
import { startEngine } from './data/engine';

import { App } from './ui/App';
import { POPOUT_VIEWS, type View } from './ui/popout';

export function boot(param: string | null) {
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
