import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import { isTauri } from '../lib/http';

export type View = 'console' | 'map' | 'alerts' | 'air' | 'news' | 'traffic' | 'cameras' | 'drones' | 'areas';

export const POPOUT_VIEWS: { view: Exclude<View, 'console'>; label: string; w: number; h: number }[] = [
  { view: 'map', label: 'Map', w: 1280, h: 800 },
  { view: 'alerts', label: 'Alerts & log', w: 520, h: 860 },
  { view: 'cameras', label: 'Camera wall', w: 960, h: 720 },
  { view: 'news', label: 'News & live TV', w: 560, h: 860 },
  { view: 'traffic', label: 'Roads', w: 520, h: 800 },
  { view: 'air', label: 'Aircraft', w: 520, h: 820 },
  { view: 'drones', label: 'Drones', w: 520, h: 720 },
];

const noThrottle = 'disabled' as BackgroundThrottlingPolicy;

/** Open a view in its own OS window so it can be dragged to another monitor. */
export async function popOut(view: Exclude<View, 'console'>) {
  const spec = POPOUT_VIEWS.find((v) => v.view === view) ?? { label: view, w: 600, h: 800 };
  const label = `popout-${view}`;
  if (isTauri()) {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, {
      url: `index.html?view=${view}`,
      title: `Vigilante · ${spec.label}`,
      width: spec.w,
      height: spec.h,
      minWidth: 360,
      minHeight: 360,
      backgroundColor: '#0B0F14',
      backgroundThrottling: noThrottle, // keep live views updating while another window has focus
    });
  } else window.open(`/?view=${view}`, label, `popup,width=${spec.w},height=${spec.h}`);
}

export type TvMode = 'latest' | 'live';

/** YouTube embed URL: the station's live stream, or its latest uploads (always available). */
export function tvUrl(channelId: string, mode: TvMode, autoplay = true): string {
  const ap = autoplay ? '&autoplay=1' : '';
  return mode === 'live'
    ? `https://www.youtube.com/embed/live_stream?channel=${channelId}${ap}`
    : `https://www.youtube.com/embed/videoseries?list=UU${channelId.slice(2)}${ap}`;
}

/** Small always-on-top player window. */
export async function openTvWindow(channelId: string, name: string, mode: TvMode) {
  const url = tvUrl(channelId, mode);
  if (isTauri()) {
    const label = 'tv-mini';
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) await existing.close();
    new WebviewWindow(label, { url, title: `${mode === 'live' ? 'Live' : 'Latest'}: ${name}`, width: 480, height: 270, alwaysOnTop: true, backgroundColor: '#000000', backgroundThrottling: noThrottle });
  } else window.open(url, 'tv-mini', 'popup,width=480,height=270');
}

/** Open an article or page outside the console. */
export async function openExternal(url: string, title = 'Vigilante') {
  if (!/^https:\/\//.test(url)) return;
  if (isTauri()) {
    const label = `web-${Math.random().toString(36).slice(2, 8)}`;
    new WebviewWindow(label, { url, title, width: 1000, height: 800 });
  } else window.open(url, '_blank', 'noopener');
}
