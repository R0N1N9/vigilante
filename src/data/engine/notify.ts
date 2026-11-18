import { APP } from '../../lib/brand';
import type { LonLat } from '../../lib/geo';
import { isTauri, webhookSend } from '../../lib/http';
import { areasContaining } from '../../lib/areas';
import { getPack } from '../../lib/packs';
import { inQuietHours, localMinutes } from '../../lib/rules';
import type { Severity } from '../../lib/signals';
import { getState } from '../store';
import { ctx, log } from './core';

let permission: boolean | null = null;

/** OS notification (Windows Action Center, macOS Notification Center, Linux desktop). */
export async function desktopNotify(title: string, body: string): Promise<boolean> {
  try {
    if (isTauri()) {
      // Loaded only in the desktop app, so the web bundle never pulls in the plugin.
      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
      permission ??= (await isPermissionGranted()) || (await requestPermission()) === 'granted';
      if (permission) sendNotification({ title, body });
      return permission;
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return false;
    new Notification(title, { body, tag: title });
    return true;
  } catch {
    return false;
  }
}

/** Is it quiet hours for something of this severity? */
export function quietNow(severity: Severity): boolean {
  const p = getState().settings.push;
  return inQuietHours(localMinutes(Date.now(), getPack(ctx.packId).timezone), p.quietStart, p.quietEnd) && severity < p.quietMinSeverity;
}

export async function sendWebhook(title: string, message: string, severity: Severity, link?: string) {
  const n = getState().settings.notify;
  if (!n.webhookUrl || !isTauri()) return; // desktop only (see webhookSend)
  try {
    await webhookSend({ url: n.webhookUrl, format: n.webhookFormat, title, message, severity, link });
    log(`HOOK   Sent to ${n.webhookFormat}: ${title}`, 0);
  } catch (e) {
    log(`HOOK   Failed: ${String(e)}`, 2);
  }
}

/**
 * General alerts (every new report, not just monitors): desktop notification
 * and team webhook above their thresholds. Watch areas raise severity one step;
 * quiet hours hold back anything below the quiet-hours level.
 */
export function notifyGeneral(item: { title: string; message: string; severity: Severity; location: LonLat | null; url?: string }) {
  const s = getState();
  const inArea = areasContaining(item.location, s.areas.filter((a) => a.alerts && a.packId === ctx.packId)).length > 0;
  const sev = Math.min(4, item.severity + (inArea ? 1 : 0)) as Severity;
  if (quietNow(sev)) return;
  const n = s.settings.notify;
  if (n.desktop && sev >= n.desktopMinSeverity) void desktopNotify(item.title, item.message);
  if (n.webhookUrl && sev >= n.webhookMinSeverity) void sendWebhook(item.title, item.message, sev, item.url);
}

export async function sendTestNotifications() {
  const ok = await desktopNotify(`${APP} test`, 'Desktop notifications are working.');
  log(ok ? 'NOTIFY Desktop test sent' : 'NOTIFY Desktop notifications are blocked. Allow them in your system settings.', ok ? 0 : 2);
  if (getState().settings.notify.webhookUrl && isTauri()) await sendWebhook(`${APP} test`, 'Webhook alerts are working.', 1);
}
