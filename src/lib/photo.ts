/**
 * Team photos ("VGI1", TEAM_PROTOCOL §4c): a JPEG sealed with the team key and
 * posted as an ntfy attachment on `<topic>-photo`; the message text is sealed
 * metadata (who, when, where, which mark, caption). Same transport as voice.
 * Photos are re-encoded before sending (≤ 1600 px, which also drops EXIF such
 * as camera GPS and device) and kept on this device once received, because
 * ntfy.sh deletes attachments after a few hours.
 */
import { openJson, sealJson } from './poscrypt';
import { openAudio, sealAudio, type VoiceChannel } from './voice';

export const photoTopic = (topic: string) => `${topic}-photo`;
export const MAX_EDGE = 1600;
export const MAX_BYTES = 1_500_000;
export const PHOTO_HINT = 'Photograph things and places: describe activity, not who someone is.';

export interface PhotoMeta {
  v: 1;
  id: string;
  n: string;
  byId: string;
  t: number;
  lat?: number;
  lon?: number;
  /** Id of the mark this photo belongs to. */
  mark?: string;
  cap: string;
  w: number;
  h: number;
  mime: 'image/jpeg';
}

export const sealPhotoMeta = (key: string, m: PhotoMeta) => sealJson(key, m, 'VGI1');

export async function openPhotoMeta(key: string, text: string): Promise<PhotoMeta | null> {
  const m = await openJson<PhotoMeta>(key, text, 'VGI1');
  if (!m || m.v !== 1 || typeof m.id !== 'string' || !m.id || (m.mime ?? 'image/jpeg') !== 'image/jpeg') return null;
  const ok = Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat!) <= 90 && Math.abs(m.lon!) <= 180;
  const clampI = (v: unknown) => Math.max(0, Math.min(10_000, Math.round(Number(v) || 0)));
  return {
    v: 1,
    id: m.id.slice(0, 40),
    n: String(m.n ?? '').slice(0, 32),
    byId: String(m.byId ?? '').slice(0, 40),
    t: Number(m.t) || 0,
    ...(ok ? { lat: m.lat, lon: m.lon } : {}),
    ...(typeof m.mark === 'string' && m.mark ? { mark: m.mark.slice(0, 40) } : {}),
    cap: String(m.cap ?? '').slice(0, 200),
    w: clampI(m.w),
    h: clampI(m.h),
    mime: 'image/jpeg',
  };
}

export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Any image the browser can open → JPEG ≤ 1600 px and ≤ 1.5 MB. Drawing through a canvas drops all EXIF; browsers apply the camera's rotation first. */
export async function prepareJpeg(file: Blob): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => createImageBitmap(file));
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const q of [0.82, 0.7, 0.58, 0.45]) {
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q));
    if (!blob) break;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length <= MAX_BYTES || q === 0.45) return { bytes, w, h };
  }
  throw new Error('Couldn’t encode this image.');
}

export async function sendPhoto(ch: VoiceChannel, meta: PhotoMeta, jpeg: Uint8Array): Promise<void> {
  const res = await fetch(`${ch.server.replace(/\/$/, '')}/${photoTopic(ch.topic)}`, {
    method: 'PUT',
    headers: {
      Filename: 'photo.vgi',
      'X-Message': await sealPhotoMeta(ch.posKey, meta),
      'X-Tags': 'vigilance-photo',
      ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}),
    },
    body: (await sealAudio(ch.posKey, jpeg)) as BodyInit,
  });
  if (!res.ok) throw new Error(res.status === 413 ? 'photo too large for this server' : res.status === 400 ? 'this ntfy server doesn’t accept attachments' : `ntfy answered HTTP ${res.status}`);
}

export async function fetchPhoto(key: string, url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const b = await openAudio(key, new Uint8Array(await res.arrayBuffer()));
  return b && isJpeg(b) ? b : null;
}

// ---------------------------------------------------------------- local store (IndexedDB)

const DB = 'vigilance-photos';
const KEEP = 100;
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const d = await db();
  return new Promise<T>((res, rej) => {
    const r = f(d.transaction('photos', mode).objectStore('photos'));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
};

export interface StoredPhoto {
  id: string;
  channelId: string;
  meta: PhotoMeta;
  jpeg: Blob;
}

export async function savePhoto(p: StoredPhoto): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(p));
    const all = await tx<StoredPhoto[]>('readonly', (s) => s.getAll());
    for (const old of all.sort((a, b) => b.meta.t - a.meta.t).slice(KEEP)) await tx('readwrite', (s) => s.delete(old.id));
  } catch {
    /* private mode: keep in memory only */
  }
}

export async function loadPhotos(): Promise<StoredPhoto[]> {
  try {
    return (await tx<StoredPhoto[]>('readonly', (s) => s.getAll())).sort((a, b) => b.meta.t - a.meta.t);
  } catch {
    return [];
  }
}

export async function photoBlob(id: string): Promise<Blob | null> {
  try {
    return (await tx<StoredPhoto | undefined>('readonly', (s) => s.get(id)))?.jpeg ?? null;
  } catch {
    return null;
  }
}

/** Parse an ntfy SSE event with an attachment. */
export function attachmentEvent(data: string): { message: string; url: string } | null {
  try {
    const e = JSON.parse(data) as { event: string; message?: string; attachment?: { url: string } };
    return e.event === 'message' && e.message && e.attachment?.url ? { message: e.message, url: e.attachment.url } : null;
  } catch {
    return null;
  }
}
