import { getJson } from '../../lib/http';
import { getPack } from '../../lib/packs';
import { parseWindy, windyUrl } from '../../lib/webcams';
import { publishData } from '../bus';
import { getState, setFeed, setState } from '../store';
import { alive, ctx, every } from './core';

/** Image links expire after ~10 minutes on the free tier, so refresh a bit sooner. */
const POLL_MS = 8 * 60_000;

export function startWebcams(gen: number) {
  const key = getState().settings.keys.windy;
  if (!key) {
    setFeed('webcams', { status: 'off', at: 0, error: 'Add a free Windy key in Settings for public webcams' });
    return;
  }
  every(async () => {
    if (!alive(gen)) return;
    const pack = getPack(ctx.packId);
    try {
      const webcams = parseWindy(await getJson(windyUrl(pack.center, pack.radiusNm * 1.852), { 'x-windy-api-key': key }));
      if (!alive(gen)) return;
      setState({ webcams });
      setFeed('webcams', { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed('webcams', { status: 'error', at: getState().feeds.webcams.at, error: String(e) });
    }
    publishData();
  }, POLL_MS);
}
