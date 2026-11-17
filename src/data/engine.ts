import { adsbUrl, normalizeAircraft, type Aircraft, type RawAircraft } from '../lib/adsb';
import { getJson, getJsonRetry } from '../lib/http';
import { alertsUrl, parseAlerts, samplePoints, severityRank, type NwsAlert, type NwsCollection } from '../lib/nws';
import { detectOrbit, type TrailPoint } from '../lib/orbit';
import { getPack } from '../lib/packs';
import { publishData } from './bus';
import { alertTone } from './sound';
import { getState, setState, subscribe, type Incident, type LogEntry } from './store';

/**
 * Leader-only polling loop. Pulls aircraft and weather alerts for the active
 * city pack, keeps short trails, detects orbits and emergencies, and turns
 * them into incidents and log entries.
 */
const ADSB_MS = 5_000;
const ADSB_BACKOFF_MS = 10_000;
const NWS_MS = 120_000;
const TRAIL_MAX_AGE_MS = 15 * 60_000;
const ORBIT_CLEAR_MS = 3 * 60_000;
const LOG_MAX = 200;

let packId = '';
let adsbTimer: number | undefined;
let nwsTimer: number | undefined;
let seenHelis = new Set<string>();
let firstAdsb = true;
let lastOrbitAt: Record<string, number> = {};
const zoneCache = new Map<string, GeoJSON.Geometry | null>();

const uid = () => Math.random().toString(36).slice(2, 10);

function log(text: string, severity: LogEntry['severity'] = 0) {
  const entry: LogEntry = { id: uid(), at: Date.now(), severity, text };
  setState({ log: [entry, ...getState().log].slice(0, LOG_MAX) });
}

function upsertIncident(inc: Incident, announce: boolean) {
  const existing = getState().incidents;
  const isNew = !existing.some((i) => i.id === inc.id);
  setState({ incidents: [inc, ...existing.filter((i) => i.id !== inc.id)] });
  if (isNew && announce) alertTone(inc.severity);
}

function removeIncidents(pred: (i: Incident) => boolean) {
  setState({ incidents: getState().incidents.filter((i) => !pred(i)) });
}

function sortIncidents() {
  const inc = [...getState().incidents].sort((a, b) => b.severity - a.severity || b.at - a.at);
  setState({ incidents: inc });
}

async function pollAdsb() {
  const pack = getPack(packId);
  const myPack = packId;
  let delay = ADSB_MS;
  try {
    const data = await getJsonRetry<{ ac?: RawAircraft[] }>(adsbUrl(pack.center, pack.radiusNm));
    if (myPack !== packId) return;
    const now = Date.now();
    const aircraft = (data.ac ?? [])
      .map((r) => normalizeAircraft(r, pack.center, pack.fieldElevationFt))
      .filter((a): a is Aircraft => a != null && a.seenS < 60);

    // Trails
    const prev = getState().trails;
    const trails: Record<string, TrailPoint[]> = {};
    for (const a of aircraft) {
      const old = (prev[a.hex] ?? []).filter((p) => now - p.t <= TRAIL_MAX_AGE_MS);
      const last = old[old.length - 1];
      const pt: TrailPoint = { lon: a.lon, lat: a.lat, t: now - a.seenS * 1000, track: a.track, alt: a.altFt };
      trails[a.hex] = last && last.lon === pt.lon && last.lat === pt.lat ? old : [...old, pt];
    }

    // Orbits
    const orbiting: Record<string, { center: [number, number]; radiusM: number; turns: number }> = {};
    for (const a of aircraft) {
      if (a.onGround) continue;
      const o = detectOrbit(trails[a.hex], now);
      if (o.orbiting) {
        orbiting[a.hex] = { center: o.center, radiusM: o.radiusM, turns: o.turns };
        const wasOrbiting = lastOrbitAt[a.hex] != null;
        lastOrbitAt[a.hex] = now;
        upsertIncident(
          {
            id: `orbit:${a.hex}`,
            kind: 'orbit',
            severity: a.kind === 'heli' ? 3 : 2,
            title: `${a.kind === 'heli' ? 'Helicopter' : 'Aircraft'} circling`,
            detail: `${a.callsign}${a.type ? ` (${a.type})` : ''} · ${o.turns.toFixed(1)} turns · r≈${(o.radiusM / 1000).toFixed(1)} km`,
            at: now,
            location: o.center,
            hex: a.hex,
          },
          !wasOrbiting,
        );
        if (!wasOrbiting) log(`ORBIT  ${a.callsign} ${a.type} circling, radius ${(o.radiusM / 1000).toFixed(1)} km`, 3);
      }
    }
    for (const [hex, at] of Object.entries(lastOrbitAt)) {
      if (now - at > ORBIT_CLEAR_MS) {
        delete lastOrbitAt[hex];
        removeIncidents((i) => i.id === `orbit:${hex}`);
      }
    }

    // Emergencies
    const emergHexes = new Set(aircraft.filter((a) => a.emergency).map((a) => a.hex));
    for (const a of aircraft) {
      if (!a.emergency) continue;
      const id = `squawk:${a.hex}`;
      const isNew = !getState().incidents.some((i) => i.id === id);
      upsertIncident(
        {
          id,
          kind: 'squawk',
          severity: 4,
          title: `Emergency: ${a.emergency}`,
          detail: `${a.callsign}${a.type ? ` (${a.type})` : ''} squawk ${a.squawk} · ${a.altFt ?? '?'} ft`,
          at: now,
          location: [a.lon, a.lat],
          hex: a.hex,
        },
        true,
      );
      if (isNew) log(`SQUAWK ${a.squawk} ${a.callsign} ${a.emergency}`, 4);
    }
    removeIncidents((i) => i.kind === 'squawk' && !emergHexes.has(i.hex ?? ''));

    // Helicopters entering the area
    const helis = aircraft.filter((a) => a.kind === 'heli');
    for (const h of helis) {
      if (!seenHelis.has(h.hex) && !firstAdsb) {
        log(`HELO   ${h.callsign}${h.type ? ` ${h.type}` : ''} entered area, ${h.distNm.toFixed(1)} nm out, ${h.aglFt ?? '?'} ft AGL`, 1);
      }
      seenHelis.add(h.hex);
    }
    firstAdsb = false;

    sortIncidents();
    setState({ aircraft, trails, orbiting, feeds: { ...getState().feeds, adsb: { status: 'live', at: now } } });
  } catch (e) {
    delay = ADSB_BACKOFF_MS;
    const lastOk = getState().feeds.adsb.at;
    const status = lastOk && Date.now() - lastOk < 60_000 ? 'stale' : 'error';
    setState({ feeds: { ...getState().feeds, adsb: { status, at: lastOk, error: String(e) } } });
  }
  publishData();
  if (myPack === packId) adsbTimer = window.setTimeout(pollAdsb, delay);
}

async function zoneGeometry(url: string): Promise<GeoJSON.Geometry | null> {
  if (zoneCache.has(url)) return zoneCache.get(url) ?? null;
  try {
    const z = await getJson<{ geometry: GeoJSON.Geometry | null }>(url);
    zoneCache.set(url, z.geometry);
    return z.geometry;
  } catch {
    zoneCache.set(url, null);
    return null;
  }
}

/** Alerts without their own polygon are drawn from their affected zones. */
async function fillGeometry(a: NwsAlert): Promise<NwsAlert> {
  if (a.geometry) return a;
  const geoms = (await Promise.all(a.affectedZones.slice(0, 12).map(zoneGeometry))).filter(
    (g): g is GeoJSON.Polygon | GeoJSON.MultiPolygon => g?.type === 'Polygon' || g?.type === 'MultiPolygon',
  );
  if (!geoms.length) return a;
  const coordinates = geoms.flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates));
  return { ...a, geometry: { type: 'MultiPolygon', coordinates } };
}

const NWS_SEVERITY: Record<string, Incident['severity']> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 1 };

async function pollNws() {
  const pack = getPack(packId);
  const myPack = packId;
  try {
    const cols = await Promise.all(samplePoints(pack.center, pack.radiusNm).map((p) => getJsonRetry<NwsCollection>(alertsUrl(p))));
    if (myPack !== packId) return;
    const parsed = parseAlerts(cols);
    const alerts = await Promise.all(parsed.map(fillGeometry));
    if (myPack !== packId) return;
    const known = new Set(getState().alerts.map((a) => a.id));
    const firstLoad = getState().feeds.nws.status === 'idle';
    for (const a of alerts) {
      upsertIncident(
        {
          id: `wx:${a.id}`,
          kind: 'weather',
          severity: NWS_SEVERITY[a.severity] ?? 1,
          title: a.event,
          detail: a.areaDesc,
          at: Date.parse(a.sent) || Date.now(),
          location: null,
          alertId: a.id,
        },
        !firstLoad && severityRank(a.severity) >= 3,
      );
      if (!known.has(a.id)) log(`NWS    ${a.event}: ${a.areaDesc.slice(0, 90)}`, NWS_SEVERITY[a.severity] ?? 1);
    }
    const live = new Set(alerts.map((a) => `wx:${a.id}`));
    removeIncidents((i) => i.kind === 'weather' && !live.has(i.id));
    sortIncidents();
    setState({ alerts, feeds: { ...getState().feeds, nws: { status: 'live', at: Date.now() } } });
  } catch (e) {
    setState({ feeds: { ...getState().feeds, nws: { status: 'error', at: getState().feeds.nws.at, error: String(e) } } });
  }
  publishData();
}

function startForPack(id: string) {
  window.clearTimeout(adsbTimer);
  window.clearInterval(nwsTimer);
  packId = id;
  seenHelis = new Set();
  firstAdsb = true;
  lastOrbitAt = {};
  setState({
    aircraft: [],
    trails: {},
    orbiting: {},
    alerts: [],
    incidents: [],
    feeds: { adsb: { status: 'idle', at: 0 }, nws: { status: 'idle', at: 0 } },
    selectedHex: null,
  });
  log(`SYSTEM Watching ${getPack(id).name}, ${getPack(id).region} (${getPack(id).radiusNm} nm radius)`);
  void pollAdsb();
  void pollNws();
  nwsTimer = window.setInterval(pollNws, NWS_MS);
}

/** Start the engine; restarts automatically when the shared city changes. */
export function startEngine() {
  startForPack(getState().packId);
  subscribe(() => {
    const id = getState().packId;
    if (id !== packId) startForPack(id);
  });
}
