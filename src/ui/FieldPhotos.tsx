/** Phone page: team photos. Take or pick a photo (resized, no EXIF, encrypted), see the team's photos, full screen on tap. */
import { useEffect, useRef, useState } from 'react';
import { ntfyStreamUrl, type NtfyChannel } from '../lib/comms';
import { attachmentEvent, fetchPhoto, loadPhotos, openPhotoMeta, photoBlob, photoTopic, PHOTO_HINT, prepareJpeg, savePhoto, sendPhoto, type PhotoMeta } from '../lib/photo';
import { memberColor } from '../lib/teamext';
import { Icon } from './Icon';

export interface FieldPhoto {
  meta: PhotoMeta;
  url: string;
}

/** Keeps the team's photos (stored on this phone) and listens for new ones. */
export function useFieldPhotos(ch: NtfyChannel | null, deviceId: string) {
  const [photos, setPhotos] = useState<FieldPhoto[]>([]);
  const urls = useRef(new Map<string, string>());
  const add = (meta: PhotoMeta, blob: Blob) => {
    if (urls.current.has(meta.id)) return;
    const url = URL.createObjectURL(blob);
    urls.current.set(meta.id, url);
    setPhotos((cur) => [{ meta, url }, ...cur].sort((a, b) => b.meta.t - a.meta.t).slice(0, 100));
  };
  useEffect(() => {
    void loadPhotos().then((all) => all.filter((p) => !ch || p.channelId === ch.topic).forEach((p) => add(p.meta, p.jpeg)));
    return () => urls.current.forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ch?.posKey) return;
    const es = new EventSource(ntfyStreamUrl({ ...ch, topic: photoTopic(ch.topic) }, '6h'));
    es.onmessage = (e) => {
      const ev = attachmentEvent(e.data);
      if (!ev) return;
      void openPhotoMeta(ch.posKey, ev.message).then(async (m) => {
        if (!m || urls.current.has(m.id)) return;
        const jpeg = await fetchPhoto(ch.posKey, ev.url).catch(() => null);
        if (!jpeg) return;
        const blob = new Blob([jpeg as BlobPart], { type: 'image/jpeg' });
        await savePhoto({ id: m.id, channelId: ch.topic, meta: m, jpeg: blob });
        add(m, blob);
        if (m.byId !== deviceId && Date.now() - m.t < 10 * 60_000) navigator.vibrate?.(60);
      });
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch?.server, ch?.topic, ch?.token, ch?.posKey, deviceId]);
  const post = async (file: Blob, meta: Omit<PhotoMeta, 'v' | 'id' | 'w' | 'h' | 'mime' | 't'>) => {
    if (!ch?.posKey) throw new Error('This team has no encryption key.');
    const { bytes, w, h } = await prepareJpeg(file);
    const full: PhotoMeta = { v: 1, id: Math.random().toString(36).slice(2, 10), t: Date.now(), w, h, mime: 'image/jpeg', ...meta };
    await sendPhoto(ch, full, bytes);
    const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    await savePhoto({ id: full.id, channelId: ch.topic, meta: full, jpeg: blob });
    add(full, blob);
  };
  return { photos, post };
}

export function PhotoViewer({ p, onClose, markName }: { p: FieldPhoto; onClose: () => void; markName?: string }) {
  return (
    <div className="field-viewer" onClick={onClose} role="dialog" aria-label="Photo">
      <img src={p.url} alt={p.meta.cap || `Photo from ${p.meta.n}`} />
      <div className="fv-cap">
        <b style={{ color: memberColor(p.meta.byId) }}>{p.meta.n}</b> · {new Date(p.meta.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {markName ? ` · ${markName}` : ''}
        {p.meta.cap && <p>{p.meta.cap}</p>}
      </div>
    </div>
  );
}

/** Take/pick a photo and post it, optionally attached to a mark. */
export function PhotoComposer({ marks, initialMark, onPost, onClose }: { marks: { id: string; name: string }[]; initialMark?: string; onPost: (file: Blob, cap: string, mark?: string) => Promise<void>; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [cap, setCap] = useState('');
  const [mark, setMark] = useState(initialMark ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="mark-form photo-composer">
      <label className="photo-drop">
        {preview ? <img src={preview} alt="Selected" /> : <span>Tap to take or choose a photo</span>}
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        <span>Caption</span>
        <input value={cap} onChange={(e) => setCap(e.target.value.slice(0, 200))} placeholder="Gate chained shut" />
      </label>
      {marks.length > 0 && (
        <label>
          <span>Attach to</span>
          <select value={mark} onChange={(e) => setMark(e.target.value)}>
            <option value="">My location (no mark)</option>
            {marks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="small-text muted">{PHOTO_HINT} Resized and stripped of the location and camera details inside the file.</p>
      {err && <p className="crit small-text">{err}</p>}
      <div className="row">
        <button className="field-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="field-btn go"
          disabled={!file || busy}
          onClick={() => {
            if (!file) return;
            setBusy(true);
            setErr('');
            onPost(file, cap, mark || undefined)
              .then(onClose)
              .catch((e) => setErr(`Not sent: ${String(e instanceof Error ? e.message : e)}`))
              .finally(() => setBusy(false));
          }}
        >
          <Icon name="camera" size={16} />
          {busy ? 'Sending…' : 'Post photo'}
        </button>
      </div>
    </div>
  );
}

export function PhotoStrip({ photos, onOpen }: { photos: FieldPhoto[]; onOpen: (p: FieldPhoto) => void }) {
  if (!photos.length) return null;
  return (
    <div className="field-photostrip">
      {photos.map((p) => (
        <button key={p.meta.id} className="photo-thumb" style={{ width: 72, height: 72, borderColor: memberColor(p.meta.byId) }} onClick={() => onOpen(p)}>
          <img src={p.url} alt={p.meta.cap || `Photo from ${p.meta.n}`} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export { photoBlob };
