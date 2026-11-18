import { useEffect, useMemo, useState } from 'react';
import { postPhoto, type PhotoInfo } from '../data/engine/photos';
import { setShared } from '../data/bus';
import { getState, setState, useStore } from '../data/store';
import { photoBlob, PHOTO_HINT } from '../lib/photo';
import { ageText } from '../lib/team';
import { memberColor } from '../lib/teamext';
import { directionsLinks } from '../lib/waypoints';
import { Icon } from './Icon';
import { openExternal } from './popout';

/** Object URL for a stored photo (revoked when the component goes away). */
export function usePhotoUrl(id: string | null | undefined) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!id) return;
    let u = '';
    let live = true;
    void photoBlob(id).then((b) => {
      if (b && live) setUrl((u = URL.createObjectURL(b)));
    });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url;
}

export const openPhoto = (id: string) => setState({ modal: 'photo', photoId: id });
export const newPhoto = (draft: { at?: [number, number]; mark?: string }) => setState({ modal: 'photo-send', photoDraft: draft });

export function PhotoThumb({ p, size = 64 }: { p: PhotoInfo; size?: number }) {
  const url = usePhotoUrl(p.id);
  return (
    <button className="photo-thumb" style={{ width: size, height: size, borderColor: memberColor(p.byId) }} onClick={() => openPhoto(p.id)} title={`${p.by}${p.cap ? `: ${p.cap}` : ''}`}>
      {url ? <img src={url} alt={p.cap || `Photo from ${p.by}`} loading="lazy" /> : <Icon name="camera" size={16} />}
    </button>
  );
}

/** Photos of one mark, plus Add photo. */
export function MarkPhotos({ markId, at }: { markId: string; at: [number, number] }) {
  const all = useStore((s) => s.photos);
  const list = useMemo(() => all.filter((p) => p.mark === markId), [all, markId]);
  return (
    <div className="mark-photos">
      {list.map((p) => (
        <PhotoThumb key={p.id} p={p} />
      ))}
      <button className="photo-thumb add" onClick={() => newPhoto({ mark: markId, at })} title="Add a photo to this mark">
        <Icon name="camera" size={16} />
        <small>Add</small>
      </button>
    </div>
  );
}

export function PhotoModal() {
  const id = useStore((s) => s.photoId);
  const p = useStore((s) => s.photos.find((x) => x.id === s.photoId));
  const mark = useStore((s) => (p?.mark ? s.marks.find((m) => m.id === p.mark) : undefined));
  const url = usePhotoUrl(id);
  if (!p) return null;
  const close = () => setState({ modal: null, photoId: null });
  const at: [number, number] | null = p.lat != null ? [p.lon!, p.lat] : mark ? mark.location : null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal wide photo-modal" role="dialog" aria-label={`Photo from ${p.by}`}>
        <div className="modal-head">
          <h2>
            <i className="avatar" style={{ background: memberColor(p.byId) }} /> {p.mine ? 'Your photo' : `Photo from ${p.by}`}
            {mark && <span className="wp-state">{mark.name.toUpperCase()}</span>}
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {url ? <img className="photo-full" src={url} alt={p.cap || 'Team photo'} /> : <p className="muted">Loading…</p>}
          {p.cap && <p className="mark-desc">{p.cap}</p>}
          <p className="mono small-text muted">
            {new Date(p.at).toLocaleString()} · {ageText(Date.now() - p.at)} ago{at ? ` · ${at[1].toFixed(5)}, ${at[0].toFixed(5)}` : ''}
          </p>
        </div>
        <div className="modal-foot">
          {at && (
            <button
              className="btn small"
              onClick={() => {
                close();
                setShared({ focus: { at: Date.now(), center: at, zoom: 17, label: p.cap || `Photo from ${p.by}` } });
                setState({ mainView: getState().mainView === 'dashboard' ? 'map' : getState().mainView });
              }}
            >
              <Icon name="locate" />
              Show on map
            </button>
          )}
          {at && (
            <button className="btn small" onClick={() => void openExternal(directionsLinks(at[1], at[0], p.cap || 'Photo').google, 'Directions')}>
              <Icon name="external" />
              Directions
            </button>
          )}
          {url && (
            <a className="btn small" href={url} download={`vigilance-${p.id}.jpg`}>
              Save
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function PhotoSendModal() {
  const draft = useStore((s) => s.photoDraft);
  const all = useStore((s) => s.channels);
  const chans = useMemo(() => all.filter((c) => c.kind === 'ntfy' && c.enabled && c.posKey), [all]);
  const mark = useStore((s) => (s.photoDraft?.mark ? s.marks.find((m) => m.id === s.photoDraft!.mark) : undefined));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [cap, setCap] = useState('');
  const [channelId, setChannelId] = useState(mark?.channelId ?? chans[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!draft) return null;
  const close = () => setState({ modal: null, photoDraft: null });
  const send = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      await postPhoto(channelId || chans[0].id, file, { mark: draft.mark, at: draft.at, cap });
      close();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal photo-send" role="dialog" aria-label="Post a photo">
        <div className="modal-head">
          <h2>
            <Icon name="camera" size={18} className="accent" /> Post a photo{mark ? ` · ${mark.name}` : ''}
          </h2>
          <button className="x" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {!chans.length ? (
            <p className="warn small-text">Photos are shared through a team channel (Team tab → Channels).</p>
          ) : (
            <>
              <label className="photo-drop">
                {preview ? <img src={preview} alt="Selected" /> : <span>Choose or drop an image</span>}
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <label className="field">
                <span>Caption</span>
                <input value={cap} onChange={(e) => setCap(e.target.value.slice(0, 200))} placeholder="Gate chained shut" />
              </label>
              {!mark && chans.length > 1 && (
                <label className="field">
                  <span>Channel</span>
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                    {chans.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="muted small-text">{PHOTO_HINT} Resized to 1600 px; location and camera details inside the file are removed. Encrypted with the team key.</p>
            </>
          )}
          {err && <p className="crit small-text">{err}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn small" onClick={close}>
            Cancel
          </button>
          <button className="btn small primary" disabled={!file || busy || !chans.length} onClick={() => void send()}>
            <Icon name="camera" />
            {busy ? 'Sending…' : 'Post photo'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Team photo board (newest first). */
export function PhotoBoard({ limit = 24 }: { limit?: number }) {
  const photos = useStore((s) => s.photos);
  if (!photos.length) return <p className="muted small-text">No photos yet. Add one from a mark, or press and hold the map → Photo.</p>;
  return (
    <div className="photo-board">
      {photos.slice(0, limit).map((p) => (
        <figure key={p.id}>
          <PhotoThumb p={p} size={96} />
          <figcaption>
            <b style={{ color: memberColor(p.byId) }}>{p.mine ? 'You' : p.by}</b> · {new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {p.cap && <span>{p.cap}</span>}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
