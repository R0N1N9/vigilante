import { invoke } from '@tauri-apps/api/core';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Fetch JSON from an allow-listed data host.
 * Desktop: through the Rust core (no CORS limits, proper User-Agent).
 * Browser dev mode: through the Vite dev server's /proxy route.
 */
export async function getJson<T>(url: string): Promise<T> {
  if (isTauri()) {
    const text = await invoke<string>('http_get', { url });
    return JSON.parse(text) as T;
  }
  const res = await fetch(`/proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** getJson with quick retries for flaky connections (resets, timeouts). */
export async function getJsonRetry<T>(url: string, attempts = 3, delayMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getJson<T>(url);
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}
