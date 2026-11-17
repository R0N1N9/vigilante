# Vigilante

A neighborhood situational-awareness console for your laptop. It watches the area around a city and tells you what's in the sky and in the weather right now. It works on one screen and lets you pop panels out onto other monitors.

> **Status: Phase 0 spike.** Live aircraft and National Weather Service alerts for **Denver** and **Atlanta**. The full roadmap is in [`docs/PLAN.md`](docs/PLAN.md).

## What it does today

- **Dark ops-style map** with a **satellite toggle** (USGS aerial imagery)
- **Live aircraft** within 25 nm of the city center (adsb.lol), with trails
  - helicopters (amber), military (blue), low aircraft (white) and **emergency squawks** 7500/7600/7700 (red) are highlighted
  - **circling detection** flags aircraft orbiting a spot, often a police, news or medical helicopter working an incident
  - an altitude ceiling filter hides airliners at cruise (essential around ATL); helicopters and emergencies always show
- **NWS alerts** drawn on the map with full text, severity-coded
- **Alerts panel + event log** in a dispatch-console style, with optional alert tones
- **City switcher** (Denver / Atlanta) and a local clock for that city
- **Pop-out windows** for the Map, Aircraft list, and Alerts & Log. Drag them to other monitors. Everything stays in sync, and window positions are remembered.

All data sources are free and need no API keys.

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

- **Switch city:** Denver / Atlanta in the top bar. Any window can switch it.
- **Select an aircraft:** click it on the map or in the list. The card shows altitude, approximate height above ground, speed, squawk and distance.
- **Pop out:** the *Pop out → Map / Aircraft / Alerts* buttons open separate windows to drag onto other screens. Closing the main window closes them all.
- **Layers panel:** toggle aircraft, trails, NWS alerts and the area ring, set a max altitude, and hide aircraft on the ground.
- **Bell icon:** mute or unmute alert tones.

## Project layout

```
packs/           City packs (Denver, Atlanta): center, radius, time zone, field elevation, radio feeds
src/lib/         Pure logic: ADS-B parsing, orbit detection, NWS parsing, geo math (unit-tested)
src/data/        Store, polling engine (main window), cross-window sync bus, alert tones
src/map/         MapLibre map, icons, basemap styles
src/ui/          Command bar, panels, cards, pop-out helper
src-tauri/       Rust core: allow-listed HTTP fetch, window-state memory, app lifecycle
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

## Known limitations (Phase 0)

- "AGL" is approximate: barometric altitude minus the city's elevation.
- Circling detection is a heuristic: about a full turn within 4 km over 10 minutes. Expect occasional false positives (flight-school maneuvers) and misses (wide orbits).
- adsb.lol rate limits are dynamic. If ADS-B shows **ERR**, the app retries automatically.
- The content security policy is disabled for the spike. It will be tightened once the full list of tile and data hosts settles.
