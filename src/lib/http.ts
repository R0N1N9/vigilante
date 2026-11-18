import { invoke } from '@tauri-apps/api/core';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Running as the hosted web app (or browser dev mode): no Rust core. */
export const isWeb = (): boolean => !isTauri();

/**
 * Where browser builds send data requests. The web build points this at the
 * Cloudflare Worker in web/proxy (VITE_PROXY_URL); dev servers serve /proxy.
 */
export function proxyUrl(url: string, base: string = import.meta.env.VITE_PROXY_URL || '/proxy'): string {
  return `${base.replace(/\/+$/, '')}?url=${encodeURIComponent(url)}`;
}

/**
 * Fetch text from an allow-listed data host (config/hosts.json).
 * Desktop: through the Rust core (no CORS limits, proper User-Agent).
 * Browser: through the CORS proxy (Vite dev server's /proxy, or the web proxy Worker).
 * Like the Rust core, no request headers are forwarded (its header allowlist is empty).
 */
export async function getText(url: string, headers?: Record<string, string>): Promise<string> {
  if (isTauri()) return invoke<string>('http_get', { url, headers: headers ?? null });
  if (headers && Object.keys(headers).length) throw new Error('request headers are not allowed');
  const res = await fetch(proxyUrl(url), { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fetch binary data (protobuf feeds, zip files) from an allow-listed host. */
export async function getBytes(url: string): Promise<Uint8Array> {
  if (isTauri()) return new Uint8Array(await invoke<ArrayBuffer>('http_get_bytes', { url }));
  const res = await fetch(proxyUrl(url), { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  return JSON.parse(await getText(url, headers)) as T;
}

async function retry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

/** getJson with quick retries for flaky connections (resets, timeouts). */
export const getJsonRetry = <T>(url: string, attempts = 3, delayMs = 800) => retry(() => getJson<T>(url), attempts, delayMs);
export const getTextRetry = (url: string, attempts = 2, delayMs = 800) => retry(() => getText(url), attempts, delayMs);
export const getBytesRetry = (url: string, attempts = 2, delayMs = 800) => retry(() => getBytes(url), attempts, delayMs);

/** Small JSON documents kept in the app data folder (desktop) or localStorage (browser). */
export async function storeRead<T>(name: string): Promise<T | null> {
  try {
    const raw = isTauri() ? await invoke<string | null>('store_read', { name }) : localStorage.getItem(`vigilante.store.${name}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function storeWrite(name: string, value: unknown): Promise<void> {
  const contents = JSON.stringify(value);
  try {
    if (isTauri()) await invoke('store_write', { name, contents });
    else localStorage.setItem(`vigilante.store.${name}`, contents);
  } catch (e) {
    console.warn('store write failed', name, e);
  }
}

export interface NtfyMessage {
  server: string;
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string;
  click?: string;
}

/** ntfy's JSON publish body (https://docs.ntfy.sh/publish/#publish-as-json). */
export function ntfyJson(m: NtfyMessage) {
  return {
    topic: m.topic,
    title: m.title,
    message: m.message,
    priority: m.priority,
    tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean),
    ...(m.click ? { click: m.click } : {}),
  };
}

/** Send a phone notification via ntfy. */
export async function ntfySend(m: NtfyMessage): Promise<void> {
  if (isTauri()) {
    await invoke('ntfy_send', { ...m, click: m.click ?? null });
    return;
  }
  // Browser: ntfy allows CORS. JSON publishing keeps non-Latin-1 titles working (HTTP headers can't carry them).
  const res = await fetch(`${m.server.replace(/\/+$/, '')}/`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ntfyJson(m)),
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
}

export interface WebhookMessage {
  url: string;
  format: 'slack' | 'discord' | 'teams' | 'json';
  title: string;
  message: string;
  severity: number;
  link?: string;
}

export const WEBHOOKS_DESKTOP_ONLY = 'Team webhooks need the desktop app';

/**
 * Post an alert to a Slack/Discord/Teams/JSON webhook. Desktop only: Slack and
 * Teams don't allow CORS, and relaying POSTs to user-supplied URLs would turn the
 * web proxy (GET-only, fixed host allowlist) into an open relay.
 */
export async function webhookSend(m: WebhookMessage): Promise<void> {
  if (!isTauri()) throw new Error(WEBHOOKS_DESKTOP_ONLY);
  await invoke('webhook_send', { ...m, link: m.link ?? null });
}
