# Vigilante

A neighborhood situational-awareness console for your laptop. It watches the area around a city and tells you what's in the sky and in the weather right now. It works on one screen and lets you pop panels out onto other monitors.

> **Status: Phase 1.** Live aircraft, drones, no-fly zones, weather, roads, cameras and local news for **Denver** and **Atlanta**, merged into developing-incident cards, a morning brief and phone alerts. The full roadmap is in [`docs/PLAN.md`](docs/PLAN.md).

## What it does

**On the map** (every layer can be switched off in the Layers panel)
- **Tactical topographic basemap:** dark vector map with terrain relief, contour lines in feet, an optional **3D terrain** view, and a satellite option. Uses free AWS terrain tiles. A coordinate and zoom readout follows the cursor.
- **Aircraft** within 25 nm (adsb.lol), with trails. Helicopters (amber), military (blue), low aircraft (white) and **emergency squawks** (red) are highlighted, aircraft **circling** a spot are flagged, and an altitude filter hides airliners at cruise.
- **Drones** via FAA **Remote ID**: drone position and height, plus the pilot's position, using this laptop's Bluetooth. See [Drones](#drones).
- **FAA no-fly zones (TFRs)** from tfr.faa.gov, as red dashed outlines. Toggle them off in Layers.
- **NWS weather alerts**, color-coded by severity
- **Road incidents and closures** (Georgia 511 / COtrip), with routine roadwork hidden
- **Transit disruptions:** RTD's official service alerts (Denver), pinned at the affected stops; police activity, medical emergencies and accidents are flagged. For MARTA (Atlanta), bus routes where several buses are 15+ minutes late, pinned where those buses are.
- **Power outages** by county from the U.S. Department of Energy's ODIN program, shaded by customers out, plus one-click links to each utility's official outage map
- **Traffic cameras**: click one for a snapshot that refreshes every few seconds
- **News pins** for every local story: exact when a neighborhood is named, approximate (city or county) otherwise. Pins cluster when zoomed out. Hover for the headline; click to open the story.
- **Wildfires** (NIFC): active wildland fires and prescribed burns within 75 nm, sized by acres
- **Scanner radio coverage:** dashed circles show each feed's approximate area; click one to start listening
- Your **watch areas**

**In the side rail**
- **Alerts:** **developing incident** cards. When signals from different sources line up in the same blocks within the same hour (for example a helicopter circling + a road closed for police activity + a news story), they merge into one card with a timeline. Below them: live alerts.
- **News:** local safety stories from local TV and newspaper feeds plus Google News, de-duplicated and filtered to stories that name your area. A small **TV player** shows a station's latest clips, or its **live stream** when it's on air, and pops out into an always-on-top **mini window**.
- **Radio:** scanner feeds for the city. Click ▶ to play inside the app.
- **City:** Roads, Transit, Power and Fire (wildfires plus structure fires and rescues from local news, grouped by place)
- **Cams:** a **camera wall** of the four cameras nearest whatever you selected
- **Sky:** aircraft list and drones (Bluetooth and Wi-Fi Remote ID, plus a simulator)
- **Areas:** draw and manage watch areas

**Around it**
- **Phone alerts** through the free **ntfy** app, with a severity threshold, an "only inside my watch areas" option and quiet hours
- **Morning brief** at a time you choose, covering the previous 8 to 24 hours: developing incidents, air activity, weather, roads, news and drones. It also goes to your phone.
- **Pop-out windows** for every panel (Map, Alerts & log, Camera wall, News & TV, Radio, City, Aircraft & drones), to drag onto other monitors. All windows stay in sync.
- **Dispatch-style event log** and alert tones

## Run it

### 1. Install prerequisites (one time)

| | Install |
|---|---|
| **All** | [Node.js 20+](https://nodejs.org/) and [Rust](https://rustup.rs/) |
| **Windows** | Microsoft C++ Build Tools ("Desktop development with C++"). WebView2 is already on Windows 10/11. |
| **macOS** | `xcode-select --install` |
| **Linux** (Debian/Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev build-essential` |

See Tauri's [prerequisites guide](https://v2.tauri.app/start/prerequisites/) if anything is unclear.

### 2. Start the desktop app

```bash
npm install
```

```bash
npm run tauri dev
```

The first build compiles the Rust core and takes a few minutes. Later starts are fast.

### 3. Build an installer (optional)

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.deb`/`.AppImage` on Linux).

### Browser-only mode (for UI work)

```bash
npm run dev
```

Then open http://localhost:5173. Pop-outs open as browser popups.

## Using it

### First-time setup (Settings ⚙)
1. **Webcams (free):** get a Windy Webcams API key at [api.windy.com](https://api.windy.com/webcams) for public skyline, street and weather cams in the camera wall and on the map.
1. **Traffic keys (free).** For Atlanta, create an account at [511ga.org](https://511ga.org), then request a developer key under *Developers*. For Denver, sign up at [manage-api.cotrip.org](https://manage-api.cotrip.org). Paste the keys into Settings.
2. **Phone alerts.** Install **ntfy** ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)), tick *Send alerts to my phone*, subscribe to the topic shown in Settings from the ntfy app, then press *Send a test notification*. The topic works like a password, so keep it random.
3. **Morning brief.** Choose a time and how many hours it covers. Leave the app running overnight so it has something to report.

### Watch areas
Open the **Areas** tab, click **Draw a new area**, click the corners on the map, then click **Finish**. Anything inside a watch area is treated as one step more urgent, and phone alerts can be limited to watch areas.

### Drones
Remote ID is a **short-range radio broadcast**, not an online feed: you only see drones within a few hundred meters of the laptop.

- **Bluetooth Remote ID:** Sky → Drones → *Scan with this laptop's Bluetooth* (macOS asks for permission).
- **Wi-Fi Remote ID (DJI Mavic 3, Mini, Air…), Linux only:** DJI drones send Remote ID as Wi-Fi beacon frames, which Bluetooth can't see. Use a Wi-Fi adapter that supports monitor mode:
  ```bash
  sudo airmon-ng start wlan0
  sudo iw dev wlan0mon set channel 6
  sudo setcap cap_net_raw+ep src-tauri/target/debug/vigilante   # re-run after every rebuild
  ```
  Then in Sky → Drones → *Wi-Fi Remote ID*, enter `wlan0mon` and press **Start Wi-Fi receiver**. The drone needs current firmware with Remote ID on, and usually a GPS lock, before it broadcasts. Monitor mode takes that adapter off your Wi-Fi network; use a second USB adapter if you need to stay online.
- **Simulate a drone** shows how a detection looks. If a drone concerns you, report it to police non-emergency or the FAA, and don't approach the pilot.

### Radio
Radio → ▶ plays a feed in a small in-app player window (Broadcastify's own player), which you can move to another monitor. You can run several at once. Rows marked BROWSE open Broadcastify's list for that area so you can pick any feed. Denver PD's radio is encrypted, so it can't be heard anywhere.

### Everything else
- **Switch city** with Denver / Atlanta in the top bar.
- **Brief (☀)** shows the latest situation brief, and **Refresh** rebuilds it.
- **Pop out ▾** opens any panel in its own window. Closing the main window closes them all.
- **Bell icon** mutes or unmutes alert tones.

## Project layout

```
packs/           City packs: center, radius, time zone, news feeds, TV channels, neighborhood gazetteer
config/hosts.json  Data hosts the app may fetch from (shared by the Rust core and dev proxy)
src/lib/         Pure logic (unit-tested): ADS-B, orbits, NWS, TFRs, traffic, news, Remote ID decoder,
                 correlation, watch areas, alert rules, brief
src/data/        Store, cross-window sync bus, alert tones
src/data/engine/ Polling engine (main window only), one module per source, plus signal history and push
src/map/         MapLibre map, icons, basemap styles
src/ui/          Command bar, panels, cards, pop-out helper
src-tauri/       Rust core: allow-listed HTTP fetch, ntfy push, settings files, Bluetooth Remote ID scanner,
                 window-state memory, app lifecycle
tests/           Vitest unit tests
```

## Tests

```bash
npm test
```

```bash
cd src-tauri && cargo test
```

## Data sources and attribution

- Aircraft: [adsb.lol](https://adsb.lol) (ODbL). It's free and community-run, so be gentle: the app polls every 5 s.
- Weather alerts: [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- Dark basemap: [OpenFreeMap](https://openfreemap.org) / © OpenMapTiles / © OpenStreetMap contributors
- Satellite: [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) (public domain)
- No-fly zones: [FAA TFR](https://tfr.faa.gov)
- Roads and cameras: [Georgia 511](https://511ga.org), [COtrip / CDOT](https://www.cotrip.org)
- Transit: [RTD GTFS and GTFS-Realtime](https://www.rtd-denver.com/open-records/open-spatial-information/real-time-feeds), [MARTA GTFS and GTFS-Realtime](https://itsmarta.com/app-developer-resources.aspx)
- Power outages: [DOE ODIN (Oak Ridge National Laboratory)](https://ornl.opendatasoft.com/explore/dataset/odin-real-time-outages-county/)
- Wildfires: [NIFC WFIGS current incident locations](https://data-nifc.opendata.arcgis.com/)
- Terrain: [AWS Terrain Tiles (Terrarium)](https://registry.opendata.aws/terrain-tiles/), contours via [maplibre-contour](https://github.com/onthegomap/maplibre-contour)
- Webcams: [Windy.com](https://www.windy.com/webcams) (attribution shown on each cam)
- Scanner radio: [Broadcastify](https://www.broadcastify.com) (played through their own web player)
- News: station RSS feeds (Denver7, 9NEWS, FOX31, Denverite, CPR News, 11Alive, FOX 5 Atlanta, WSB-TV, Atlanta News First) and Google News search RSS. Headlines link to the original story.
- Phone alerts: [ntfy](https://ntfy.sh)

## Known limitations

- **Denver traffic is untested.** COtrip's incident format isn't public without a key, so the parser is deliberately tolerant. Denver cameras are blocked on finding COtrip's camera endpoint, which needs a key to look up. Atlanta (Georgia 511) follows 511's published format, and its camera snapshots were tested live.
- **Live TV** relies on YouTube embeds. Stations only stream live during newscasts and breaking news; otherwise use *Latest*. If a desktop webview refuses to play the embed, use the **Mini ↗** window.
- **Power outage coverage is partial.** ODIN only includes utilities that report to it. Around Denver that's United Power and CORE Electric, but not Xcel Energy, which serves most of the city. In Atlanta, Georgia Power and the EMCs don't report to it. Their own outage maps are one click away in the Power tab. Their internal map data feeds are undocumented, so the app doesn't use them.
- **Radio plays through Broadcastify's own player**, not a raw stream URL, to stay within their terms. The feed list is curated per city, and coverage circles are approximate.
- **Live fire-department dispatch** (structure fires and medical calls) isn't published as open data in Denver or Atlanta. Wildfires come from NIFC; structure fires and rescues come from local news and the radio.
- **Windy webcams are untested** without a key; the parser follows Windy's v3 documentation.
- **MARTA has no alerts feed**, so Atlanta transit disruptions are inferred from late buses. Rail isn't covered: MARTA's rail data needs a separate key.
- **The brief and developing incidents only know what the app saw while it was running.** History is kept for 72 hours.
- **News places** come from a built-in neighborhood list. Stories that only say "Denver" aren't pinned, to avoid false precision.
- **"AGL" is approximate:** barometric altitude minus the city's elevation. Circling detection is a heuristic.
- **API keys are stored in a plain settings file** in the app data folder. Moving them to the OS keychain is planned.
- adsb.lol rate limits are dynamic. If ADS-B shows **ERR**, the app retries automatically.
- The content security policy is still disabled during development.
