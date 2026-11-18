/**
 * Field Agent phone app: the console's data engine and views (Now, Map, Radio scanner) in field mode.
 * Loaded only when the agent opens one of those tabs. It posts as the agent (their callsign and device
 * id), keeps its own storage, and receives team events from the Team page instead of opening its own
 * streams (see ui/fieldBridge.ts).
 */
import { useEffect, useState } from 'react';
import { setShared } from './data/bus';
import { ingestFieldEvent } from './data/engine/comms';
import { startEngine } from './data/engine';
import { getState, setState, subscribe, useStore } from './data/store';
import type { NtfyChannel } from './lib/comms';
import { packForCoords } from './lib/embedPack';
import type { LonLat } from './lib/geo';
import { setStorePrefix, storeRead, storeWrite } from './lib/http';
import { getPack, registerPacks, type CityPack } from './lib/packs';
import { MapStage, Rail } from './ui/App';
import { NowTiles } from './ui/Dashboard';
import { setAgentSink } from './ui/fieldBridge';
import { Icon } from './ui/Icon';
import { Modals } from './ui/Modals';
import { RadioTab } from './ui/RadioTab';

export interface AgentIdentity {
  channel: NtfyChannel | null;
  callsign: string;
  deviceId: string;
}

let started: Promise<void> | null = null;

/** Start the engine once (field mode, own storage), then keep identity and channel in sync with the Team page. */
export function startAgent(id: AgentIdentity) {
  started ??= (async () => {
    setStorePrefix('vigilance.agent.store.');
    setState({ fieldMode: true });
    let known = getState().locations;
    subscribe(() => {
      const l = getState().locations;
      if (l !== known) {
        known = l;
        registerPacks(l);
      }
    });
    await startEngine();
    setAgentSink((k, d) => ingestFieldEvent(k, d));
  })();
  return started.then(() => syncAgent(id));
}

export function syncAgent(id: AgentIdentity) {
  const s = getState();
  const team = { ...s.settings.team, callsign: id.callsign || 'Agent', installId: id.deviceId };
  const channels: NtfyChannel[] = id.channel ? [{ ...id.channel, enabled: true, shareAlerts: 0 as const }] : [];
  const same = s.settings.team.callsign === team.callsign && s.settings.team.installId === team.installId && JSON.stringify(s.channels) === JSON.stringify(channels);
  if (!same) setShared({ settings: { ...s.settings, team }, channels });
}

/** Point the scanner at a location (GPS): builds a watch area there, like the console's location picker. */
export async function scanAt(at: LonLat) {
  const p = await packForCoords(at);
  const saved = (await storeRead<CityPack[]>('locations')) ?? [];
  const next = [p, ...saved.filter((l) => l.id !== p.id)].slice(0, 12);
  await storeWrite('locations', next);
  registerPacks(next);
  setShared({ locations: next });
  setState({ packId: p.id });
  setShared({ focus: { at: Date.now(), center: at, zoom: 13, label: 'You' } });
}

function useGps() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = () => {
    setBusy(true);
    setErr('');
    navigator.geolocation.getCurrentPosition(
      (p) =>
        void scanAt([p.coords.longitude, p.coords.latitude])
          .catch((e) => setErr(String(e?.message ?? e)))
          .finally(() => setBusy(false)),
      (e) => {
        setBusy(false);
        setErr(e.code === e.PERMISSION_DENIED ? 'Location is blocked. Allow it for this site to scan where you are.' : 'Couldn’t get your location.');
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120_000 },
    );
  };
  return { busy, err, go };
}

function ScanBar() {
  const pack = useStore((s) => getPack(s.packId));
  const located = useStore((s) => s.locations.some((l) => l.id === s.packId));
  const gps = useGps();
  // First visit: scan where the agent is.
  useEffect(() => {
    if (!located && 'geolocation' in navigator) gps.go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="agent-scan">
      <span className="dot" />
      <div>
        <small className="mono">SCANNING</small>
        <b>{pack.name}</b>
        {gps.err && <p className="crit small-text">{gps.err}</p>}
      </div>
      <button className="field-btn ping-btn" onClick={gps.go} disabled={gps.busy}>
        <Icon name="locate" size={16} />
        {gps.busy ? 'Locating…' : 'Scan here'}
      </button>
    </div>
  );
}

/** Now: what's happening around the agent, the same sources as the console dashboard and rail. */
export function AgentNow() {
  return (
    <div className="agent-now">
      <ScanBar />
      <NowTiles />
      <div className="agent-rail">
        <Rail />
      </div>
    </div>
  );
}

/** Map: the console's live map (team, marks, waypoints, photos, aircraft, incidents…), with the hold ring. */
export function AgentMap({ visible }: { visible: boolean }) {
  // The map was laid out while hidden; let it measure itself again when shown.
  useEffect(() => {
    if (visible) window.dispatchEvent(new Event('resize'));
  }, [visible]);
  return (
    <div className="agent-map">
      <MapStage />
      <p className="agent-map-hint mono">Press and hold the map for actions</p>
    </div>
  );
}

const STATE_FIPS: Record<string, number> = {
  Alabama: 1, Alaska: 2, Arizona: 4, Arkansas: 5, California: 6, Colorado: 8, Connecticut: 9, Delaware: 10, 'District of Columbia': 11, Florida: 12, Georgia: 13, Hawaii: 15, Idaho: 16, Illinois: 17, Indiana: 18, Iowa: 19, Kansas: 20, Kentucky: 21, Louisiana: 22, Maine: 23, Maryland: 24, Massachusetts: 25, Michigan: 26, Minnesota: 27, Mississippi: 28, Missouri: 29, Montana: 30, Nebraska: 31, Nevada: 32, 'New Hampshire': 33, 'New Jersey': 34, 'New Mexico': 35, 'New York': 36, 'North Carolina': 37, 'North Dakota': 38, Ohio: 39, Oklahoma: 40, Oregon: 41, Pennsylvania: 42, 'Rhode Island': 44, 'South Carolina': 45, 'South Dakota': 46, Tennessee: 47, Texas: 48, Utah: 49, Vermont: 50, Virginia: 51, Washington: 53, 'West Virginia': 54, Wisconsin: 55, Wyoming: 56,
};

/** Radio scanner: feeds for this area, plus where to find more (as Vigil's radio guide). */
export function AgentRadio() {
  const pack = useStore((s) => getPack(s.packId));
  const fips = STATE_FIPS[pack.power.state];
  const links = [
    fips && { label: `Live scanner feeds · ${pack.power.state}`, url: `https://www.broadcastify.com/listen/stid/${fips}`, note: 'Police, fire and EMS audio (Broadcastify)' },
    fips && { label: `Local frequencies · ${pack.power.state}`, url: `https://www.radioreference.com/db/browse/stid/${fips}`, note: 'Agencies and their frequencies (RadioReference)' },
    { label: 'Recent dispatch audio', url: 'https://openmhz.com/systems', note: 'Recorded trunked-radio calls (OpenMHz)' },
    { label: 'NOAA Weather Radio', url: 'https://www.weather.gov/nwr/', note: 'Your nearest weather radio transmitter' },
  ].filter(Boolean) as { label: string; url: string; note: string }[];
  return (
    <div className="field-card agent-radio">
      <h3>Scanner · {pack.name}</h3>
      <RadioTab />
      <div className="agent-links">
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
            <b>{l.label}</b>
            <small>{l.note}</small>
          </a>
        ))}
      </div>
    </div>
  );
}

export function AgentModals() {
  return <Modals />;
}
