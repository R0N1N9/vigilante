import { invoke } from '@tauri-apps/api/core';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Fetch text from an allow-listed data host (config/hosts.json).
 * Desktop: through the Rust core (no CORS limits, proper User-Agent).
 * Browser dev mode: through the Vite dev server's /proxy route.
 */
export async function getText(url: string): Promise<string> {
  if (isTauri()) return invoke<string>('http_get', { url });
  const res = await fetch(`/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fetch binary data (protobuf feeds, zip files) from an allow-listed host. */
export async function getBytes(url: string): Promise<Uint8Array> {
  if (isTauri()) return new Uint8Array(await invoke<ArrayBuffer>('http_get_bytes', { url }));
  const res = await fetch(`/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
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

/** Send a phone notification via ntfy. */
export async function ntfySend(m: NtfyMessage): Promise<void> {
  if (isTauri()) {
    await invoke('ntfy_send', { ...m, click: m.click ?? null });
    return;
  }
  const res = await fetch(`${m.server.replace(/\/$/, '')}/${encodeURIComponent(m.topic)}`, {
    method: 'POST',
    body: m.message,
    headers: { Title: m.title, Priority: String(m.priority), Tags: m.tags, ...(m.click ? { Click: m.click } : {}) },
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}`);
}
