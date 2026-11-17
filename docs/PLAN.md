# Vigilante: Neighborhood Situational Awareness Console

**Status:** Phase 1 built: aircraft, transit disruptions, power outages, drones (Remote ID), FAA TFRs, NWS, roads/cameras, local news + TV, watch areas, developing incidents, morning brief and phone alerts for Denver/Atlanta. See the README.
**Target:** Desktop app for Windows, macOS and Linux laptops. Works on one screen and scales out to several monitors.
**Inspiration:** [World Monitor](https://github.com/koala73/worldmonitor) (global OSINT dashboard), police CAD/dispatch consoles, and the tar1090 and MarineTraffic map UIs.

---

## 1. Product vision

One console that answers **"what is happening near me right now?"** For a user-defined Area of Interest (AOI), it pulls together:

- live **map layers**: incidents, aircraft, vessels, weather, traffic, cameras
- **radio**: police, fire and EMS scanner audio with live transcripts
- **news and social** feeds, filtered to items about the AOI
- **public-safety data**: crime reports, 911/CAD calls, fire/EMS dispatches, alerts
- an **alert engine** that links related signals into one "developing incident" card

The design idea is a dispatch console that stays calm when nothing is happening and gets loud when something does.

---

## 2. Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust core + system webview) | Builds are about 10 MB, versus about 150 MB for Electron. It has native multi-window and monitor APIs (`availableMonitors`, `emit_to`) and permissions per window. World Monitor also ships a Tauri desktop build. |
| UI | **React + TypeScript + Vite**, Tailwind, Radix UI primitives | Fast to build and easy to theme. |
| Map | **MapLibre GL JS**, with **deck.gl** overlays added when needed | Free and open. Phase 0 uses MapLibre's built-in layers, which handle a few hundred aircraft easily. deck.gl comes in for heavy layers (vessels, heatmaps, replay). |
| Basemap | **Protomaps / OpenFreeMap** vector tiles, plus optional satellite (Esri World Imagery, Mapbox) | Google Maps can be added as an optional layer through its Map Tiles API. It costs money and has strict terms, so it should not be the default. |
| Ingestion | Rust async workers (tokio + reqwest + tungstenite) | Workers poll APIs and hold WebSockets open, then normalize everything into a single `Event` schema. |
| Storage | **SQLite** with FTS5 (full-text news search) and R*Tree (spatial queries) | Runs on the laptop with no server, and supports replay and history. |
| Audio | Webview `<audio>` / HLS.js for streams; **whisper.cpp** for transcription, with a small model on the CPU by default | The `tiny` and `base` Whisper models run on most laptops without a GPU. A cloud speech-to-text option can be added later. |
| AI (optional) | **Cloud LLM** (e.g. a small, fast Claude model through the Claude API), off by default | Uses: morning brief, news relevance scoring, incident summaries. The app has to run on ordinary laptops, so no local LLM. Rule-based relevance works without any AI. |
| Plugins | Each data source is a "connector" module behind a common trait or interface | Lets new sources be added without touching the core. |

### Core data model

```ts
Event {
  id, source, category,          // e.g. "pulsepoint", "fire.structure"
  title, body, url,
  geometry,                      // point, line or polygon (GeoJSON)
  severity: 0-4,                 // info .. critical
  observed_at, expires_at,
  confidence,                    // geocoding/relevance confidence
  links: EventId[]               // correlated events
  raw                            // original payload
}
Track { id, kind: aircraft|vessel, positions[], meta }   // moving objects
```

All filtering, alerting and correlation code works on `Event` and `Track`, so the source of an item does not matter to it.

---

## 3. Layout and multi-monitor design

The app is a **workspace of panels**. Every panel can be docked, tabbed or popped out into its own OS window, and those windows can be dragged to any monitor. The Rust core acts as the single shared store and broadcasts updates to all windows, so map selections and alerts stay in sync everywhere.

The app saves **layout profiles keyed to the monitor setup it detects** (laptop only, laptop + 1, docked with 3 screens). When a monitor is plugged in or removed, it switches to the matching profile.

### Single screen (laptop)
```
+--------------------------------------------------------------+
| AOI: Maple Heights v | 21:42:07 | 3 ALERTS | scanner > [||||]|  <- command bar
+---------------------------------------+----------------------+
|                                       | ALERTS / INCIDENTS   |
|                MAP                    | ! Structure fire ... |
|     (layers toggle, top-left)         | ! Helicopter orbit . |
|                                       +----------------------+
|                                       | [News][Radio][Air]   |  <- tabbed side rail
|                                       |  feed items ...      |
+---------------------------------------+----------------------+
| TICKER: 21:41 PD Disp 2 "units respond 400 blk Oak St" ...   |
+--------------------------------------------------------------+
```

### Three monitors
```
 [ Left ]                 [ Center ]                [ Right ]
 Radio console            Full-screen map           News + social wall
 - channel strips         - all layers              - 2-3 feed columns
 - live transcripts       - incident cards pinned   - camera grid (2x2)
 - keyword hits           - timeline scrubber       - weather/radar
```

### Interaction
- **Command palette** (Ctrl/Cmd+K): "go to Oak St", "mute fire dispatch", "show helicopters", "replay last 2h"
- Keyboard-first controls, CAD style (F-keys acknowledge alerts)
- **Time scrubber** to replay the last N hours across every layer at once
- **Focus mode**: clicking an incident centers every window on it

---

## 4. Visual design language

- **Theme:** dark ops-center look. Near-black blue-gray background (`#0B0F14`), raised panels at `#111821`, 1px hairline borders (`#1E2a36`). No heavy gradients, and only subtle glass effects.
- **One accent color:** cyan (`#3DD6F5`) for interactive and selected elements. Every other color carries meaning:
  - critical red `#FF4D4F`, warning amber `#FFB020`, info blue `#4C8DFF`, resolved green `#2BD47D`
- **Type:** *Inter* for UI text, *JetBrains Mono / IBM Plex Mono* for data (timestamps, callsigns, unit IDs, coordinates), with tabular numbers.
- **Motion:** subtle pulse rings on new map incidents, smooth track interpolation for aircraft and boats, no bouncy animation.
- **Map styling:** a desaturated dark basemap, so colored data stands out against it.
- **Night / red-light mode** for late-night use, and a high-contrast light mode for daytime.
- **Sound design:** short, distinct alert tones per severity, like a dispatch console. They can be muted per category.

---

## 5. Feature modules and data sources

Legend: **Free** / **Key** (free API key) / **Paid** / **Unofficial** (undocumented endpoint, may break or conflict with terms) / **HW** (needs your own receiver hardware)

### 5.1 Area of Interest (AOI)
- Home pin + radius, or a polygon drawn on the map. Multiple named AOIs (home, work, kid's school).
- The AOI filters every connector. Its bounding box is also passed to APIs that accept one (aisstream, ADS-B, GDELT).
- A gazetteer for the AOI (street names, neighborhoods, landmarks from **OpenStreetMap / Overpass**), used to geocode text from news items and scanner transcripts.

### 5.2 Scanner radio
| Source | Type | Notes |
|---|---|---|
| **Self-hosted SDR**: RTL-SDR dongle + [trunk-recorder](https://github.com/robotastic/trunk-recorder) + [rdio-scanner](https://github.com/chuot/rdio-scanner) | HW, Free | **Best option.** Records individual calls with talkgroup metadata. Hardware costs about $40–100. |
| **OpenMHz** | Free | Hosted per-call audio with a JSON API, for systems someone else already feeds. |
| **Broadcastify** live feeds | Free to *listen* on their site; no API | The live-feed catalog API is [closed to new scanner apps](https://support.broadcastify.com/hc/en-us/articles/204740425-Live-Audio-Feed-Catalog-API). Broadcastify Calls API access [requires an application](https://www.broadcastify.com/calls/dev/client-api). |
| Radio frequency database | RadioReference (premium) | Lists the systems, talkgroups and frequencies in your county. |

Features:
- channel strips with per-talkgroup mute, solo and volume (like a real scanner)
- **live transcription** with whisper.cpp, plus **keyword alerts** ("shots fired", "structure fire", "pursuit") and AOI street names
- an address mentioned in a transcript is geocoded and dropped on the map as an unverified pin
- caveat: more departments are **encrypting** their radio, so coverage depends on where you live

### 5.3 911 / CAD, fire and EMS
- **PulsePoint**: Unofficial. Community wrappers exist (e.g. the `pulsepoint` npm package), but the data is encoded and the terms are unclear. Use it only if you accept that risk.
- **City real-time 911 / CAD feeds** on open data portals (Seattle Fire 911, Cincinnati ECC incidents, many others): Free
- **Wildfire:** NASA **FIRMS** hotspots (Key), InciWeb, CAL FIRE (CA)

### 5.4 Crime and civic data
- **City open data portals** (Socrata/Tyler Data & Insights, ArcGIS Hub): crime incidents, calls for service, arrests. Free. Coverage varies a lot by city.
- **SpotCrime** (Key/Paid) and **CrimeoMeter** (Paid) for broader coverage
- **Open311 / 311 requests**: Free. Covers abandoned vehicles, street-light outages, illegal dumping.
- **FBI Wanted API** (`api.fbi.gov/wanted`): Free
- **FBI Crime Data Explorer** API for long-term crime trends: Key
- **Missing persons / AMBER alerts:** NamUs, plus AMBER/Blue alerts delivered through IPAWS and NWS feeds

### 5.5 Sex offender registry (needs special handling, see section 8)
- **NSOPW has no public API.** Its [Conditions of Use](https://nsopw.gov/en/conditions) bind you to every state's terms, and many states prohibit scraping, redistribution, or using the data to harass or take vigilante action.
- **Recommended design:** a "Registry lookup" panel that **deep-links** to the NSOPW / state registry search, pre-filled for your AOI. Where a state offers a **licensed bulk download** (e.g. Hawaii, Connecticut), import that file locally under its license and show addresses as a *static awareness layer* with the agency's disclaimer and a "last updated" date.
- **Not recommended:** scraping NSOPW, combining registry data with other people-data, or building "track this person" alerts. These raise legal and safety problems (see section 8).

### 5.6 Aircraft
| Source | Type |
|---|---|
| **adsb.lol** (`api.adsb.lol/v2`, ADSBx-compatible, ODbL) | Free (key planned; feeding data earns one) |
| **airplanes.live** | Free, about 1 request/s |
| **OpenSky Network** | Free for non-commercial use, OAuth2 |
| **Your own receiver**: RTL-SDR + 1090 MHz antenna + `readsb`/`tar1090` | HW. Lowest latency, and lets you feed the networks above in exchange for API access. |

Features worth building:
- **orbit detection**: flag helicopters or planes circling the AOI, which often signals police, news or medical activity
- **emergency squawk** alerts (7500 hijack / 7600 radio failure / 7700 emergency)
- police, medical, military and government aircraft tagged from public type and operator databases
- tap a track for its history trail, photo (planespotters.net) and route

### 5.7 Boats and vessels (if the AOI is near water)
- **aisstream.io**: free WebSocket with bounding-box subscriptions (Key, beta, no SLA)
- **AISHub**: free if you feed it data
- **Your own receiver**: RTL-SDR or dAISy + [AIS-catcher](https://github.com/jvde-github/AIS-catcher) (HW)
- Features: vessel-type icons, Coast Guard / law enforcement highlighting, loitering detection, NOAA tides and buoys (NDBC)

### 5.8 News and social
- **Local outlet RSS** (newspapers, TV stations, Patch), plus **Google News RSS** queries (`"<town name>"` OR neighborhood names)
- **GDELT DOC 2.0 / GEO API**: Free, global, geocoded news
- **Reddit** (local subreddits, Key), **Bluesky** (open search and firehose with keyword filters, Free), **Mastodon** local instances
- Not available: Nextdoor and Citizen have no public API. X/Twitter's API is expensive.
- **Relevance engine:**
  1. Gazetteer match (street, neighborhood or landmark names in the AOI)
  2. Keyword and category rules
  3. Optional local LLM classification and summary ("Is this about my area? Category? Severity?")
  4. Deduplicate stories from many outlets into one item
- Full-text search across history (SQLite FTS5)

### 5.9 Weather and hazards
- **NWS** `api.weather.gov` active alerts and forecasts: Free
- **Radar:** RainViewer tiles (Free) or NOAA MRMS
- **USGS earthquakes** GeoJSON: Free
- **Air quality:** AirNow (Key), PurpleAir (Key)
- **FEMA** disaster declarations and IPAWS alert archive: Free

### 5.10 Traffic, cameras and infrastructure
- **State 511 APIs:** incidents, closures, construction and **traffic cameras** (Key, varies by state)
- **TomTom / HERE** traffic flow tiles (freemium)
- **Windy Webcams API** for nearby public webcams (Key)
- **Power outages:** utility outage maps (unofficial JSON, varies by utility), DOE ODIN, poweroutage.us (Paid)
- **Camera wall panel:** 2x2 or 3x3 grid of the cameras nearest the selected incident

### 5.11 Your own sensors (optional; makes the app much more useful)
- **Frigate NVR** (open source, local AI object detection) on your own home cameras, with person and vehicle events sent to the timeline
- **Home Assistant** integration (door sensors, doorbells)
- **Meshtastic** LoRa mesh: off-grid text messaging between participating neighbors that keeps working during outages. A good fit for a neighborhood watch.

---

## 6. The "fusion" layer

This is the part that makes Vigilante more than a set of tabs.

- **Correlation engine:** groups events close in space and time from *different* sources. Example: a scanner transcript says "fire on Oak St", PulsePoint lists a structure fire 0.2 mi away, a news helicopter is orbiting overhead, and a Bluesky post mentions smoke. Together these become one **Developing Incident** card with a confidence score.
- **Severity scoring:** combines source reliability, category, distance from home, and how many sources corroborate the event.
- **Alerts:** desktop notifications, dispatch-style tones, and optional phone push via **ntfy** (self-hostable) or Pushover. Quiet hours and per-category rules.
- **Daily brief:** an AI-written summary each morning or evening ("Overnight: 2 vehicle break-ins on Elm, a power outage on the north side, a weather advisory tomorrow").
- **Stability dashboard (built):** a World Monitor-style board with a Neighborhood Stability Index (0–100) from weighted risk factors, rule-based insights, per-neighborhood ratings, and an on-demand Claude briefing that receives only aggregate counts and headlines.
- **Incident log / notebook:** add your own notes to incidents and export the shift log (Markdown/PDF), useful for watch-group meetings.
- **Replay:** scrub back through time across all layers.
- **Heatmaps:** crime and call density by hour and weekday over the last 30/90 days.

---

## 7. Architecture

```
            +---------------- Rust core (Tauri) ----------------+
 Connectors |  adsb  ais  scanner  news  nws  crime  511  ...   |
 (plugins)  |     \    |     |      |     |     |     /         |
            |      +--- Normalizer -> Event/Track ---+          |
            |                 |                                 |
            |   Geofence (AOI) -> Correlator -> Alert engine    |
            |                 |                                 |
            |        SQLite (events, tracks, FTS, R*Tree)       |
            +------------------|--------------------------------+
                               | IPC events (emit_to per window)
          +--------------------+-------------------+
          |                    |                   |
     Main window          Map window          Radio window   ...
    (React + MapLibre/deck.gl, shared Zustand store mirrored from core)

  Optional sidecars: whisper.cpp, trunk-recorder/rdio-scanner, readsb, AIS-catcher, Ollama
```

- Each connector declares: poll interval or stream, auth, rate limits, an AOI filter, and a mapping to `Event`.
- API keys are stored in the **OS keychain**, not in files.
- **Rate-limit and caching etiquette** is built in, because many sources are community-run.
- Sidecars (SDR tools, whisper) are optional and detected automatically. The app works without any of them.

---

## 8. Legal, ethical and safety guardrails (read before building)

1. **Sex offender data:** Use it only as permitted by NSOPW and each state's terms. Many states make it a crime to use registry information to harass, threaten or commit a crime against a registrant. The app should show the official disclaimer, link to the source, show data age, and **never** offer features for following, tracking or sharing a specific person.
2. **Unofficial APIs** (PulsePoint, utility outage JSON) can break and may violate terms of service. Keep them as opt-in connectors, disabled by default.
3. **Scanner use:** Listening is legal in most of the US, but some states restrict scanners in vehicles or using scanner information while committing a crime. Never attempt to decrypt encrypted channels (illegal under federal law).
4. **Recording and retention:** Keep audio and transcripts local, with automatic expiry.
5. **Licensing:** World Monitor is **AGPL-3.0**. Copying its code makes Vigilante AGPL too. Taking inspiration from its ideas or UI patterns is fine. adsb.lol data is ODbL (attribution and share-alike).
6. **Accuracy:** Scanner traffic and social posts are **unverified**. The UI should label confidence clearly, so the app doesn't spread rumors in a neighborhood group chat.
7. **"Observe and report":** Frame the product as situational awareness for calling 911 and keeping neighbors informed, not as a tool for confronting people. (The repo name is fun, but the UI copy should steer users the other way.)

---

## 9. Decisions (Nov 2026)

| Question | Decision | Effect on the design |
|---|---|---|
| First area | **Denver**, then **Atlanta** | AOIs are grouped into **city packs** (section 10). The app supports several cities from day one. |
| Radio hardware | Baofeng **UV-5RM** handhelds (not available yet); Broadcastify for online listening | See 9.1 and 9.2 |
| Paid services | **None for now** | Phases 0–5 use only free and free-key sources. Paid connectors are stubs. |
| Users | Solo testing first, **watch group later** | Local-first now, but the data model is ready for sharing (9.3). |
| AI | Must run on almost any laptop, so **cloud AI, optional** | Off by default. Bring your own API key, stored in the OS keychain. |
| Map | Google Maps is the long-term preference; **start with a free dark map + satellite toggle** | Free satellite imagery: **USGS National Map imagery** (public domain, sharp US aerial photos), with Esri World Imagery as a fallback (attribution required). Google can be added later as a provider plugin (Maps JS / Map Tiles API, which needs a billing account but has a free monthly usage tier). |

### 9.1 What the Baofeng UV-5RM can and can't do
- It receives **analog FM only**. Denver's and Atlanta's police and fire run on **digital P25 trunked systems**, many of them encrypted, which a Baofeng **cannot** decode.
- Still useful:
  - **NOAA Weather Radio** (162.400–162.550 MHz)
  - ham radio **SKYWARN / ARES** nets during severe weather
  - analog channels that remain (some businesses, events, rail)
- **Line-in connector:** a cheap Kenwood 2-pin to 3.5 mm audio cable runs from the radio to the laptop's mic or line input. The app treats that as a "radio channel": level meter, recording, and Whisper transcription with keyword alerts.
- Transmitting: ham bands require an amateur license. The UV-5RM is **not certified for GMRS/FRS**, so watch-group radio chat should use GMRS radios (license, no exam) or Meshtastic.
- Later upgrade: an **RTL-SDR v4** (~$40) with trunk-recorder can decode *unencrypted* P25 talkgroups, which is the only way to get scanner audio Broadcastify doesn't carry.

### 9.2 Broadcastify approach (free)
- No API and no embed player. The embed player was [retired](https://forums.radioreference.com/threads/why-was-the-embedded-feed-function-removed-without-notice.502303/), and the catalog API excludes scanner apps.
- **Plan:** a **"Web Radio" panel**, an in-app browser view that opens Broadcastify's own listen pages for feeds saved per city. It behaves exactly like listening in a normal browser: their player, their ads, their terms. The app adds a saved feed list, tags each feed by agency, and remembers the panel's monitor position.
- **No stream-URL scraping and no rebroadcasting to the watch group.** Each member listens through their own Broadcastify session.
- Transcription of Broadcastify audio is **not** in scope (no clean way to get the audio). Transcription will come from the line-in Baofeng, OpenMHz, or an SDR.

### 9.3 Ready for watch-group sharing
- Every Event and note has a UUID, an author, and a `shared: bool` flag. Nothing is shared unless the user marks it.
- Later, a **sync server**: self-hosted **PocketBase** (free, a single binary) or a free hosted tier. It would provide a shared incident log, shared AOIs and city packs, and member alerts through **ntfy**.
- Only *your own notes and incident summaries* are shared. Raw third-party data (Broadcastify audio, registry records) is never redistributed.

---

## 10. City packs

A city pack is a JSON file (`packs/denver.json`, `packs/atlanta.json`) listing that city's AOI presets, feeds, endpoints, gazetteer seeds and saved radio feeds. Switching cities from the command bar swaps the pack. You can also watch both cities at once, one per monitor.

> Status notes come from web research in Nov 2026. Items marked *verify* must be checked during implementation.

### Denver, CO
| Category | Source | Notes |
|---|---|---|
| Police radio | **Denver PD encrypted since July 2019** ([CPR](https://www.cpr.org/2019/08/08/the-denver-police-just-encrypted-their-scanners-and-journalists-are-protesting-the-silence)); Aurora since 2016 | Don't expect DPD audio. Check suburban agencies on Colorado DTRS (P25) for unencrypted talkgroups. *verify* |
| Fire/EMS radio | Broadcastify **"Denver Fire Alerting and EMS"** ([feed](https://Broadcastify.com/listen/feed/7435)) | Station alerting, Fire 1, and Denver Health EMS. Tactical and fireground channels are encrypted. |
| Crime | Denver Open Data **DenverCrime** ArcGIS FeatureServer + CSV | Updated Mon–Fri with about a **2-day lag**. CC BY 3.0. Shows trends, not live events. |
| Traffic | **COtrip** (CDOT) API at maps.cotrip.org | Key requirements *verify* |
| Weather | NWS **Boulder (BOU)** office alerts; NASA FIRMS (wildfire smoke and fires); AirNow (ozone and smoke) | |
| Aircraft | adsb.lol / airplanes.live | Filter out DEN airliners at cruise altitude. Highlight **helicopters** (Flight For Life, news, law enforcement) and orbits. |
| News | Denver Post, Denverite, CPR News, Denver7, 9NEWS, KDVR FOX31, CBS Colorado, Axios Denver, Westword; r/Denver | RSS + Google News RSS + GDELT |
| Vessels | Low value (no major waterways) | Layer off by default |

### Atlanta, GA
| Category | Source | Notes |
|---|---|---|
| Police radio | APD encryption status **unclear**. *verify* on Broadcastify Fulton County. Georgia State Patrol has mostly moved to SouthernLinc LTE (not receivable). | |
| Fire/EMS radio | Broadcastify **Atlanta Fire Rescue** and **Atlanta Metro** multi-agency feeds ([Fulton County list](https://www.broadcastify.com/listen/ctid/442)) | Run by volunteers, so availability varies. Fulton County Public Safety P25 system: [RadioReference sid 8340](https://radioreference.com/db/sid/8340). |
| Crime | **APD Open Data Portal** (opendata.atlantapd.org, ArcGIS) | REST endpoint *verify* |
| Traffic | **Georgia 511 API** ([docs](https://511ga.org/developers/doc)) | Free key, **10 calls / 60 s**. Cameras, alerts, message signs: a strong source for the camera wall. |
| Weather | NWS **Peachtree City (FFC)** alerts; severe storms and tornado warnings are the main hazard | |
| Aircraft | adsb.lol / airplanes.live | ATL is the world's busiest airport, so **aggressive filtering** (below 3,000 ft AGL, helicopters, orbits) is essential |
| News | AJC, 11Alive, WSB-TV, FOX 5 Atlanta, Atlanta News First, WABE, Axios Atlanta; r/Atlanta | |
| Vessels | Low value (Lake Lanier and the Chattahoochee only) | Layer off by default |

### Both cities
- **PulsePoint:** look up agencies by coordinates; neither city has been confirmed as participating. *verify*. Opt-in, since it's an unofficial connector.
- **Registry lookup:** deep links to the [Colorado](https://apps.colorado.gov/apps/dps/sor/) and [Georgia](https://state.sor.gbi.ga.gov/sort_public/) state registry searches and to NSOPW. *verify* URLs. No scraping.

---

## 11. Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0. Spike** | Tauri + MapLibre; Denver/Atlanta; live aircraft with helicopter/orbit/squawk detection; NWS alerts; pop-out windows | ✅ Done |
| **1. Situational picture** | Watch areas (draw on map); FAA no-fly zones (toggleable); Georgia 511 / COtrip road incidents + **camera wall** (refreshing snapshots); local news (RSS + Google News, de-duplicated, place-matched) with a **TV player** (latest clips / live, mini window); **drone Remote ID** over Bluetooth + simulator; **developing-incident** correlation; **morning brief**; **phone alerts** via ntfy (thresholds, watch-area boost, quiet hours); signal history persisted 72 h | ✅ Done |
| **1a. City infrastructure** | Transit disruptions (RTD alerts with stop locations; MARTA late-bus detection) and county power outages (DOE ODIN) on the map, in the City tab, the brief and phone alerts | ✅ Done |
| **1c. Field intel + look** | Radio tab with in-app players and coverage on the map; Wi-Fi Remote ID (Linux monitor mode) for DJI drones; NIFC wildfires; fire/rescue news; Windy webcams; news pins for every local story (clustered, click to open); topographic basemap (relief, contours, 3D); compact top bar; tactical styling | ✅ Done |
| **1d. Web app + embeds** | Web build of the same `src/` (`web/`), Cloudflare Worker CORS proxy with the same host allowlist (`web/proxy/`), local-storage settings, browser ntfy, own-key AI and AIS, `embed.html` + one-tag `embed.js` loader, Get-the-app dialog with local QR codes, GitHub Pages workflow. Same guardrails as section 8: public keyless sources, no tracking or identifying people, nothing behind logins | ✅ Done |
| **1b. Verify with keys** | Check COtrip's incident schema against a live response, add Denver cameras, check the Georgia 511 events format against live data | Needs your free keys |
| **2. Radio** | **Web Radio panel** (Broadcastify pages), **line-in channel** for the Baofeng with Whisper transcripts + keyword alerts, OpenMHz connector | Next |
| **3. Public safety data** | Denver crime (30/90-day heatmap), APD open data, 311, registry lookup panel (deep links), opt-in PulsePoint | |
| **4. Better drone coverage** | ESP32 Remote ID receiver over USB serial (adds Wi-Fi-only drones such as many DJI models) | |
| **5. AI layer (optional, cloud)** | Rewrite the brief as prose, classify ambiguous news, summarize incidents | |
| **6. Watch group** | PocketBase sync, shared incident log and watch areas, member roles, blurring of faces and plates in shared photos | |
| **7. Polish** | Command palette, red-light mode, OS keychain for keys, installers + auto-update, optional Google Maps provider | |

## 12. Remaining open items
- Check the *verify* items in section 10 as each connector is built.
- Decide later whether to buy an RTL-SDR, which would unlock unencrypted P25 audio and your own ADS-B receiver.
- Choose a cloud AI provider when the AI features land (phase 6).
