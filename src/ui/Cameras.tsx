import { useEffect, useMemo, useState } from 'react';
import { setState, useStore } from '../data/store';
import { getPack } from '../lib/packs';
import { nearestCameras, type Camera } from '../lib/traffic';

const REFRESH_MS = 8000;

/** A traffic camera snapshot that refreshes every few seconds, like a slow video feed. */
export function CameraTile({ cam, big = false }: { cam: Camera; big?: boolean }) {
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const src = `${cam.imageUrl}${cam.imageUrl.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / REFRESH_MS)}`;
  return (
    <figure className={`cam ${big ? 'big' : ''}`} onClick={() => setState({ cameraId: cam.id })}>
      {err ? <div className="cam-err">Camera offline</div> : <img key={tick} src={src} alt={cam.name} referrerPolicy="no-referrer" onError={() => setErr(true)} onLoad={() => setErr(false)} />}
      <figcaption>
        <span className="cam-live">● LIVE</span> {cam.name}
      </figcaption>
    </figure>
  );
}

export function CameraViewer() {
  const id = useStore((s) => s.cameraId);
  const cam = useStore((s) => s.cameras.find((c) => c.id === s.cameraId));
  if (!id || !cam) return null;
  return (
    <div className="overlay cam-viewer">
      <div className="ac-head">
        <b className="mono">{cam.roadway || 'Camera'} {cam.direction}</b>
        <button className="x" onClick={() => setState({ cameraId: null })} aria-label="Close">
          ×
        </button>
      </div>
      <CameraTile cam={cam} big />
    </div>
  );
}

/** The four cameras nearest whatever you're looking at (focused incident, else city center). */
export function CamerasTab({ wall = 4 }: { wall?: number }) {
  const cameras = useStore((s) => s.cameras);
  const focus = useStore((s) => s.focus);
  const pack = useStore((s) => getPack(s.packId));
  const feed = useStore((s) => s.feeds.traffic);
  const center = focus?.center ?? pack.center;
  const near = useMemo(() => nearestCameras(cameras, center, wall), [cameras, center, wall]);

  if (!cameras.length)
    return (
      <div className="list">
        <div className="callout">
          {pack.traffic.provider === 'cotrip' ? (
            <>
              <b>Denver cameras: coming once a COtrip key is added.</b>
              <p>COtrip doesn't publish its camera feed without a key. Add one in Settings and the camera list can be wired up.</p>
            </>
          ) : feed.status === 'off' ? (
            <>
              <b>Add a free Georgia 511 key to see traffic cameras.</b>
              <p>Snapshots refresh every few seconds and the wall follows whatever incident you select.</p>
            </>
          ) : (
            <b>Loading cameras…</b>
          )}
          <button className="btn" onClick={() => setState({ modal: 'settings' })}>
            Open Settings
          </button>
        </div>
      </div>
    );

  return (
    <div className="list">
      <div className="row-head">
        <span className="mono muted small-text">Nearest to {focus ? 'the selected spot' : `${pack.name} center`} · {cameras.length} cameras in area</span>
      </div>
      <div className={`cam-wall n${wall}`}>
        {near.map((c) => (
          <CameraTile key={c.id} cam={c} />
        ))}
      </div>
    </div>
  );
}
