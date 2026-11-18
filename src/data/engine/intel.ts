import { distanceM, NM_TO_M } from '../../lib/geo';
import { getJsonRetry, getTextRetry } from '../../lib/http';
import {
  airPointsUrl, airSamplePoints, airSeverity, arcgisQuery, parseAirPoints, arcgisSince, ATLANTA_CRIME, DENVER_311, DENVER_CRIME, FAA_STATUS_URL, fbiUrl, FIRMS_URLS, gaugeSeverity, lsrUrl, nwpsUrl,
  parseAirportStatus, parseAtlantaCrime, parseDenver311, parseDenverCrime, parseFirms, parseGauges, parseLsr, parseQuakes, parseUsgsCams, parseWanted,
  QUAKES_URL, quakeSeverity, stormSeverity, USGS_CAMS_URL, type Hotspot,
} from '../../lib/intel';
import { getPack } from '../../lib/packs';
import { publishData } from '../bus';
import { getState, setFeed, setState, type FeedName } from '../store';
import { alive, ctx, emitSignal, every, log, removeIncidents, upsertIncident } from './core';

/** Run one poller with uniform feed-status handling. */
function poll(gen: number, feed: FeedName, ms: number, fn: (first: boolean) => Promise<void>, skip?: string) {
  if (skip) {
    setFeed(feed, { status: 'off', at: 0, error: skip });
    return;
  }
  let first = true;
  every(async () => {
    if (!alive(gen)) return;
    try {
      await fn(first);
      if (!alive(gen)) return;
      first = false;
      setFeed(feed, { status: 'live', at: Date.now() });
    } catch (e) {
      setFeed(feed, { status: 'error', at: getState().feeds[feed].at, error: String(e) });
    }
    publishData();
  }, ms);
}

const DAY = 24 * 3600_000;

export function startIntel(gen: number) {
  const pack = getPack(ctx.packId);
  const c = pack.center;
  const r = pack.radiusNm;

  // Crime: last 7 days of reported offenses (city open data, ~daily updates).
  poll(
    gen,
    'crime',
    30 * 60_000,
    async (first) => {
      const since = arcgisSince(Date.now() - 7 * DAY);
      const crimes =
        pack.intel.crime === 'denver'
          ? parseDenverCrime(await getJsonRetry(arcgisQuery(DENVER_CRIME, `REPORTED_DATE >= TIMESTAMP '${since}'`, 'OFFENSE_ID,OFFENSE_TYPE_ID,OFFENSE_CATEGORY_ID,REPORTED_DATE,FIRST_OCCURRENCE_DATE,INCIDENT_ADDRESS,GEO_LON,GEO_LAT,NEIGHBORHOOD_ID', 'REPORTED_DATE DESC')))
          : parseAtlantaCrime(await getJsonRetry(arcgisQuery(ATLANTA_CRIME, `ReportDate >= TIMESTAMP '${since}'`, 'ReportNumber,NIBRS_Offense,Crime_Against,Part,FireArmInvolved,ReportDate,OccurredFromDate,StreetAddress,Longitude,Latitude,NhoodName', 'ReportDate DESC')));
      if (!alive(gen)) return;
      const known = new Set(getState().crimes.map((x) => x.id));
      for (const x of crimes) {
        if (known.has(x.id) || x.severity < 2 || Date.now() - x.at > 2 * DAY) continue;
        emitSignal(
          { id: `crime:${x.id}`, source: 'crime', kind: x.category, title: `${x.offense}${x.firearm ? ' (firearm)' : ''}`, detail: `${x.address}${x.neighborhood ? `, ${x.neighborhood}` : ''}`, severity: x.severity, at: x.at, location: x.location, packId: ctx.packId },
          { quiet: first },
        );
      }
      setState({ crimes });
    },
    pack.intel.crime ? undefined : 'No open crime data for this area yet (Denver and Atlanta supported)',
  );

  // 311 service requests: last 3 days.
  poll(
    gen,
    's311',
    30 * 60_000,
    async () => {
      const since = arcgisSince(Date.now() - 3 * DAY);
      const requests311 = parseDenver311(await getJsonRetry(arcgisQuery(DENVER_311, `Case_Created_Date >= TIMESTAMP '${since}'`, 'OBJECTID,Case_Summary,Case_Status,Agency,Case_Created_Date,Incident_Address_1,Incident_Intersection_1,Longitude,Latitude,Neighborhood', 'Case_Created_Date DESC')));
      if (alive(gen)) setState({ requests311 });
    },
    pack.intel.s311 ? undefined : 'No open 311 data for this area (Denver supported; Atlanta does not publish 311 openly)',
  );

  // NASA FIRMS satellite fire detections (keyless public CSVs, last 24 h).
  poll(gen, 'firms', 15 * 60_000, async (first) => {
    const csvs = await Promise.allSettled(FIRMS_URLS.map((u) => getTextRetry(u)));
    const ok = csvs.filter((x): x is PromiseFulfilledResult<string> => x.status === 'fulfilled');
    if (!ok.length) throw new Error('all FIRMS downloads failed');
    const seen = new Set<string>();
    const hotspots: Hotspot[] = ok.flatMap((x) => parseFirms(x.value, c, 75)).filter((h) => !seen.has(h.id) && seen.add(h.id));
    if (!alive(gen)) return;
    const known = new Set(getState().hotspots.map((h) => h.id));
    const fires = getState().fires;
    for (const h of hotspots) {
      if (known.has(h.id) || distanceM(h.location, c) > r * NM_TO_M) continue;
      // A heat signature in the area with no known wildfire nearby is worth a look.
      const explained = fires.some((f) => distanceM(f.location, h.location) < 5000);
      emitSignal(
        { id: h.id, source: 'hotspot', kind: 'hotspot', title: `Satellite heat detection${explained ? '' : ' (no known fire)'}`, detail: `${h.satellite}, ${h.frp.toFixed(1)} MW, ${h.day ? 'day' : 'night'} pass`, severity: explained ? 1 : 2, at: h.at, location: h.location, packId: ctx.packId },
        { quiet: first },
      );
    }
    setState({ hotspots });
  });

  // Earthquakes (USGS, past week, within 300 km).
  poll(gen, 'quakes', 10 * 60_000, async (first) => {
    const quakes = parseQuakes(await getJsonRetry(QUAKES_URL), c);
    if (!alive(gen)) return;
    const known = new Set(getState().quakes.map((q) => q.id));
    for (const q of quakes) {
      const sev = quakeSeverity(q);
      if (sev >= 2 && Date.now() - q.at < DAY) upsertIncident({ id: q.id, kind: 'quake', severity: sev, title: `M${q.mag.toFixed(1)} earthquake`, detail: `${q.place} · ${Math.round(q.distKm)} km away`, at: q.at, location: q.location, url: q.url }, !first && !known.has(q.id));
      if (!known.has(q.id) && sev >= 1)
        emitSignal({ id: q.id, source: 'quake', kind: 'quake', title: `M${q.mag.toFixed(1)} earthquake`, detail: q.place, severity: sev, at: q.at, location: q.location, url: q.url, packId: ctx.packId }, { quiet: first, regional: true });
    }
    removeIncidents((i) => i.kind === 'quake' && !quakes.some((q) => q.id === i.id && Date.now() - q.at < DAY));
    setState({ quakes });
  });

  // River gauges and flood stages (NOAA NWPS).
  poll(gen, 'floods', 15 * 60_000, async (first) => {
    const gauges = parseGauges(await getJsonRetry(nwpsUrl(c, r)));
    if (!alive(gen)) return;
    for (const g of gauges) {
      const sev = gaugeSeverity(g);
      if (sev >= 1) {
        upsertIncident({ id: g.id, kind: 'flood', severity: sev, title: `River ${g.category.replace('_', ' ')} stage`, detail: `${g.name}${g.stage != null ? ` · ${g.stage} ${g.unit}` : ''}`, at: Date.now(), location: g.location, url: g.url }, !first);
        emitSignal({ id: `${g.id}:${g.category}:${new Date().toDateString()}`, source: 'flood', kind: g.category, title: `${g.name}: ${g.category} flooding`, detail: g.stage != null ? `${g.stage} ${g.unit}` : '', severity: sev, at: Date.now(), location: g.location, packId: ctx.packId }, { quiet: first });
      }
    }
    removeIncidents((i) => i.kind === 'flood' && !gauges.some((g) => g.id === i.id && gaugeSeverity(g) >= 1));
    setState({ gauges });
  });

  // Air quality at the city center (Open-Meteo, US AQI).
  poll(gen, 'air', 30 * 60_000, async (first) => {
    const pts = airSamplePoints(c, pack.radiusNm * NM_TO_M);
    const airPoints = parseAirPoints(await getJsonRetry(airPointsUrl(pts.map((p) => p.at))), pts);
    const air = airPoints[0]?.air ?? null;
    if (!alive(gen)) return;
    if (air && airSeverity(air) >= 1) {
      upsertIncident({ id: 'air', kind: 'air', severity: airSeverity(air), title: `Air quality: ${air.label}`, detail: `US AQI ${air.aqi} · PM2.5 ${air.pm25.toFixed(0)} µg/m³`, at: air.at, location: null }, !first);
      emitSignal({ id: `air:${airSeverity(air)}:${new Date().toDateString()}`, source: 'air', kind: 'aqi', title: `Air quality ${air.label.toLowerCase()} (AQI ${air.aqi})`, detail: '', severity: airSeverity(air), at: air.at, location: null, packId: ctx.packId }, { quiet: first, regional: true });
    } else removeIncidents((i) => i.kind === 'air');
    setState({ air, airPoints });
  });

  // FAA airport delays / ground stops for this area's airports.
  poll(
    gen,
    'airports',
    5 * 60_000,
    async (first) => {
      const airportDelays = parseAirportStatus(await getTextRetry(FAA_STATUS_URL), pack.intel.airports);
      if (!alive(gen)) return;
      for (const d of airportDelays)
        upsertIncident({ id: `apt:${d.airport}:${d.kind}`, kind: 'airport', severity: d.kind === 'Ground stop' || d.kind === 'Closure' ? 2 : 1, title: `${d.airport}: ${d.kind}`, detail: `${d.reason}${d.detail ? ` · ${d.detail}` : ''}`, at: Date.now(), location: null }, !first);
      removeIncidents((i) => i.kind === 'airport' && !airportDelays.some((d) => i.id === `apt:${d.airport}:${d.kind}`));
      setState({ airportDelays });
    },
    pack.intel.airports.length ? undefined : 'No airports configured for this area',
  );

  // NWS local storm reports via Iowa Environmental Mesonet (spotter reports: hail, wind damage, flooding, tornadoes).
  poll(
    gen,
    'storms',
    10 * 60_000,
    async (first) => {
      const storms = parseLsr(await getJsonRetry(lsrUrl(pack.region, 24)), c, r);
      if (!alive(gen)) return;
      const known = new Set(getState().storms.map((s) => s.id));
      for (const s of storms) {
        const sev = stormSeverity(s);
        if (known.has(s.id) || sev < 2) continue;
        upsertIncident({ id: s.id, kind: 'storm', severity: sev, title: `Storm report: ${s.type}`, detail: `${s.city}${s.magnitude ? ` · ${s.magnitude} ${s.unit}` : ''}`, at: s.at, location: s.location }, !first);
        emitSignal({ id: s.id, source: 'storm', kind: s.type, title: `Storm report: ${s.type}`, detail: `${s.city} ${s.remark}`.trim(), severity: sev, at: s.at, location: s.location, packId: ctx.packId }, { quiet: first });
      }
      setState({ storms });
    },
    /^[A-Z]{2}$/.test(pack.region) ? undefined : 'State unknown',
  );

  // FBI Wanted for this field office.
  poll(
    gen,
    'wanted',
    6 * 3600_000,
    async (first) => {
      const wanted = parseWanted(await getJsonRetry(fbiUrl(pack.intel.fbiOffice!)));
      if (!alive(gen)) return;
      setState({ wanted });
      // A newly posted missing-person or wanted poster for this field office is worth telling the team.
      for (const w of wanted)
        emitSignal(
          { id: `fbi:${w.id}`, source: 'fbi', kind: w.kind, title: `New FBI poster: ${w.label} · ${w.title}`, detail: [w.subjects[0], w.warning].filter(Boolean).join(' · '), severity: w.kind === 'missing' ? 2 : 1, at: w.published || Date.now(), location: null, url: w.url, packId: ctx.packId },
          { quiet: first || Date.now() - w.published > 7 * 86_400_000, regional: true },
        );
    },
    pack.intel.fbiOffice ? undefined : 'No FBI field office set for this area',
  );

  // USGS river cameras (keyless): added to the camera wall alongside traffic cams.
  poll(gen, 'cams', 30 * 60_000, async (first) => {
    const cams = parseUsgsCams(await getJsonRetry(USGS_CAMS_URL), c, 40);
    if (!alive(gen)) return;
    setState({ webcams: cams });
    if (first && cams.length === 0) log('CAMS   No active USGS river cameras within 40 nm', 0);
  });
}

