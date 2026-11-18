/** Team photos (TEAM_PROTOCOL §4c): receive, keep on this device, and send. */
import { ntfyStreamUrl, type NtfyChannel } from '../../lib/comms';
import { attachmentEvent, fetchPhoto, loadPhotos, openPhotoMeta, photoTopic, prepareJpeg, savePhoto, sendPhoto, type PhotoMeta } from '../../lib/photo';
import { setShared } from '../bus';
import { getState } from '../store';
import { log } from './core';
import { desktopNotify } from './notify';

export interface PhotoInfo {
  id: string;
  channelId: string;
  by: string;
  byId: string;
  at: number;
  lat?: number;
  lon?: number;
  mark?: string;
  cap: string;
  w: number;
  h: number;
  mine: boolean;
}

const info = (m: PhotoMeta, channelId: string): PhotoInfo => ({
  id: m.id,
  channelId,
  by: m.n || 'Unknown',
  byId: m.byId,
  at: m.t,
  ...(m.lat != null ? { lat: m.lat, lon: m.lon } : {}),
  ...(m.mark ? { mark: m.mark } : {}),
  cap: m.cap,
  w: m.w,
  h: m.h,
  mine: m.byId === getState().settings.team.installId,
});

function add(p: PhotoInfo) {
  const cur = getState().photos;
  if (cur.some((x) => x.id === p.id)) return false;
  setShared({ photos: [p, ...cur].sort((a, b) => b.at - a.at).slice(0, 100) });
  return true;
}

let loaded = false;
export async function loadStored() {
  if (loaded) return;
  loaded = true;
  const all = await loadPhotos();
  const cur = getState().photos;
  const seen = new Set(cur.map((p) => p.id));
  setShared({ photos: [...cur, ...all.filter((p) => !seen.has(p.id)).map((p) => info(p.meta, p.channelId))].sort((a, b) => b.at - a.at).slice(0, 100) });
}

const streams = new Map<string, { es: EventSource; key: string }>();

export function connectPhotos(ch: NtfyChannel) {
  void loadStored();
  const key = `${ch.server}|${ch.topic}|${ch.token}|${ch.posKey}`;
  const cur = streams.get(ch.id);
  if (cur?.key === key) return;
  cur?.es.close();
  if (!ch.posKey) return void streams.delete(ch.id);
  // ntfy.sh keeps attachments ~3 h; older events are only useful if we already stored the photo.
  const es = new EventSource(ntfyStreamUrl({ ...ch, topic: photoTopic(ch.topic) }, '6h'));
  es.onmessage = (e) => {
    const ev = attachmentEvent(e.data);
    if (!ev) return;
    void openPhotoMeta(ch.posKey, ev.message).then(async (m) => {
      if (!m || getState().photos.some((p) => p.id === m.id)) return;
      const jpeg = await fetchPhoto(ch.posKey, ev.url).catch(() => null);
      if (!jpeg) return;
      await savePhoto({ id: m.id, channelId: ch.id, meta: m, jpeg: new Blob([jpeg as BlobPart], { type: 'image/jpeg' }) });
      const p = info(m, ch.id);
      if (!add(p) || p.mine || Date.now() - m.t > 10 * 60_000) return;
      const mark = m.mark ? getState().marks.find((x) => x.id === m.mark)?.name : '';
      log(`TEAM   Photo from ${p.by}${mark ? ` at "${mark}"` : ''}${p.cap ? `: ${p.cap}` : ''}`, 0);
      void desktopNotify(`Photo from ${p.by}`, p.cap || (mark ? `At ${mark}` : 'New team photo'));
    });
  };
  streams.set(ch.id, { es, key });
}

export function dropPhotos(live: Set<string>) {
  for (const [id, st] of streams)
    if (!live.has(id)) {
      st.es.close();
      streams.delete(id);
    }
}

/** Post a photo from this console: re-encoded (no EXIF), sealed, stored locally right away. */
export async function postPhoto(channelId: string, file: Blob, opts: { mark?: string; at?: [number, number]; cap?: string }) {
  const s = getState();
  const ch = s.channels.find((x): x is NtfyChannel => x.id === channelId && x.kind === 'ntfy');
  if (!ch?.posKey) throw new Error('Pick a team channel with an encryption key.');
  const { bytes, w, h } = await prepareJpeg(file);
  const meta: PhotoMeta = {
    v: 1,
    id: Math.random().toString(36).slice(2, 10),
    n: s.settings.team.callsign || 'Ops',
    byId: s.settings.team.installId,
    t: Date.now(),
    ...(opts.at ? { lat: opts.at[1], lon: opts.at[0] } : {}),
    ...(opts.mark ? { mark: opts.mark } : {}),
    cap: (opts.cap ?? '').trim().slice(0, 200),
    w,
    h,
    mime: 'image/jpeg',
  };
  await sendPhoto(ch, meta, bytes);
  await savePhoto({ id: meta.id, channelId, meta, jpeg: new Blob([bytes as BlobPart], { type: 'image/jpeg' }) });
  add(info(meta, channelId));
}
