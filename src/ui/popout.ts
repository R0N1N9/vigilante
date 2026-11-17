import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import { isTauri } from '../lib/http';

export type View = 'console' | 'dashboard' | 'map' | 'alerts' | 'sky' | 'news' | 'radio' | 'traffic' | 'cameras' | 'areas' | 'team';

export const POPOUT_VIEWS: { view: Exclude<View, 'console'>; label: string; w: number; h: number }[] = [
  { view: 'dashboard', label: 'Dashboard', w: 1500, h: 950 },
  { view: 'map', label: 'Map', w: 1280, h: 800 },
  { view: 'alerts', label: 'Alerts & log', w: 520, h: 860 },
  { view: 'team', label: 'Team chat', w: 480, h: 820 },
  { view: 'cameras', label: 'Camera wall', w: 960, h: 720 },
  { view: 'news', label: 'News & live TV', w: 560, h: 860 },
  { view: 'traffic', label: 'Roads, transit, power & fire', w: 520, h: 820 },
  { view: 'radio', label: 'Radio', w: 480, h: 760 },
  { view: 'sky', label: 'Aircraft & drones', w: 520, h: 820 },
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
      title: `Vigilance · ${spec.label}`,
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

/**
 * Play a scanner feed inside the app. Uses Broadcastify's own web player
 * (their audio, ads and terms) in a small window you can keep on any monitor.
 */
export async function openRadio(feed: { name: string; url: string }) {
  if (!/^https:\/\/www\.broadcastify\.com\//.test(feed.url)) return;
  const label = `radio-${feed.url.replace(/[^a-z0-9]/gi, '').slice(-24)}`;
  if (isTauri()) {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, { url: feed.url, title: `Radio: ${feed.name}`, width: 460, height: 680, backgroundColor: '#0B0F14', backgroundThrottling: noThrottle });
  } else window.open(feed.url, label, 'popup,width=460,height=680');
}

/** Open an article or page outside the console. */
/** Hand a mailto: or sms: link to the system's mail or messaging app. */
export async function openSystem(url: string) {
  if (!/^(mailto|sms):/.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.location.href = url;
}

export async function openExternal(url: string, title = 'Vigilance') {
  if (!/^https:\/\//.test(url)) return;
  if (isTauri()) {
    const label = `web-${Math.random().toString(36).slice(2, 8)}`;
    new WebviewWindow(label, { url, title, width: 1000, height: 800 });
  } else window.open(url, '_blank', 'noopener');
}
