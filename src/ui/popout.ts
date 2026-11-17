import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import { isTauri } from '../lib/http';

export type View = 'console' | 'map' | 'air' | 'alerts';

const TITLES: Record<Exclude<View, 'console'>, string> = {
  map: 'Vigilante · Map',
  air: 'Vigilante · Aircraft',
  alerts: 'Vigilante · Alerts & Log',
};

/** Open a view in its own OS window so it can be dragged to another monitor. */
export async function popOut(view: Exclude<View, 'console'>) {
  const label = `popout-${view}`;
  if (isTauri()) {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, {
      url: `index.html?view=${view}`,
      title: TITLES[view],
      width: view === 'map' ? 1280 : 520,
      height: view === 'map' ? 800 : 820,
      minWidth: 360,
      minHeight: 360,
      backgroundColor: '#0B0F14',
      // Keep live views updating while another window has focus.
      backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
    });
  } else {
    const w = view === 'map' ? 1280 : 520;
    window.open(`/?view=${view}`, label, `popup,width=${w},height=820`);
  }
}
