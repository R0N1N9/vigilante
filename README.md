# Vigilance

A neighborhood situational-awareness console for your laptop. It watches the area around a city and tells you what's in the sky and in the weather right now. It works on one screen and lets you pop panels out onto other monitors.

Built for people who keep watch over a place: physical security and asset protection teams, executive protection details, security patrol, neighborhood watch, and anyone who wants their own operations desk.

> **Status: Phase 1.** Live aircraft, drones, no-fly zones, weather, roads, cameras and local news for **Denver** and **Atlanta**, merged into developing-incident cards, a morning brief and phone alerts. The full roadmap is in [`docs/PLAN.md`](docs/PLAN.md).

## What it does

**Keyless intel sources (no sign-ups)**
| Source | What you get |
|---|---|
| Denver Police / Atlanta Police open data | Crime reports for the last 7 days: heatmap, points up close, firearm flag, time-of-day chart |
| Denver 311 | Service requests for the last 3 days (Atlanta doesn't publish 311 openly) |
| NASA FIRMS | Satellite heat detections (VIIRS + MODIS) for the last 24 h; flags detections with no known fire nearby |
| NEXRAD radar (Iowa Environmental Mesonet) | Live weather radar overlay, refreshed every 5 min |
| USGS | Earthquakes within 300 km; ~1,400 river cameras nationwide (the camera wall) |
| NOAA NWPS | River gauges and flood stages |
| NWS local storm reports (IEM) | Spotter reports: hail, wind damage, flooding, tornadoes |
| Open-Meteo | Current air quality (US AQI) |
| FAA NAS status | Ground stops and delays at local airports |
| FBI Wanted & missing persons | Full posters for the local field office: wanted fugitives, **missing people** and seeking-information cases, with photo, description, reward, the official PDF and a tip link |

**Dashboard** (Map | Dashboard switch in the top bar, or Pop out → Dashboard for a second monitor)
- **SITREP strip:** location, overall condition, violent reports in the last 48 h, open situations, helicopters airborne, air quality and live feeds.
- **Neighborhood Stability Index (0–100, higher is calmer):** a ring gauge plus a risk meter per factor (crime 30%, incidents 25%, weather and hazards 20%, fire 10%, infrastructure 10%, air 5%). One severe factor caps the score, so a tornado warning can't be averaged away. Crime and gunfire are compared with the city's own week, not a fixed bar. Levels: Stable ≥80, Guarded ≥60, Elevated ≥40, High ≥20, Severe below. A 24-hour trend line builds as the app runs.
- **Tactical locator:** a live map inside the dashboard. Click almost anything on the dashboard (an insight, a news story, a neighborhood, a camera, a situation, a status cell) and the locator flies there and drops a labeled reticle. If there's a related page (the story, the police crime map, the USGS quake page, NASA FIRMS, the utility outage map, the aircraft on ADS-B), it opens too. A Map window on another monitor follows along.
- **Analyst insights:** plain-language findings from the data (crime vs this week's normal, busiest hours, unexplained satellite heat, circling aircraft, outages, quakes, air quality). **✦ AI briefing** (optional Claude key) turns a compact summary into a short analyst note. It sends counts and headlines only, never your location history, watch areas or keys, and only when you press the button.
- **Broadcast** (local TV), **camera grid**, **local news feed**, **active situations**, **sector ratings** (neighborhoods ranked by severity-weighted crime reports this week), **7-day crime activity** and a **status board**.

**On the map** (every layer can be switched off in the Layers panel). Hover over anything for a short tooltip saying what it is and what a click does.
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
- **Wanted & missing posters** (City → Wanted & missing, plus a dashboard panel): the FBI's posters for your field office as a poster wall, filtered by Wanted, Missing or Seeking info, with missing people listed first. Open one for the full poster: photo, physical description, case details, warnings ("armed and dangerous"), reward, the printable PDF, **Submit a tip** and **Share to team**. A newly posted poster for your area becomes an alert. There are also links to NCMEC (missing children) and NamUs (missing persons) for wider searches. The guidance is always to report, never to approach.
- **Cams:** a **camera wall** of the four cameras nearest whatever you selected
- **Sky:** aircraft list and drones (Bluetooth and Wi-Fi Remote ID, plus a simulator)
- **Areas:** draw and manage watch areas

**Alerts and monitoring**
- **Monitors** (Watch tab): your own alert rules.
  - **Keywords:** any new report (news, crime, traffic, weather, transit…) whose text contains your words or phrases, e.g. "shots fired", a street name or a client's company name.
  - **Radius around a point:** anything reported within a set distance of a site, a residence or a route stop. Pick the point on the map; the ring is drawn on the map.
  - **Aircraft watchlist:** callsign or tail-number prefixes, ICAO hex codes, `type:AS50`, or classes like `type:heli`, `type:military`, `type:emergency`.
  - **Threshold:** a live number crossing a line: stability index, AQI, customers without power, violent reports in 48 h, helicopters up, aircraft circling, active weather alerts, or data feeds failing (system health).
  - Each monitor sets its alert level, a cooldown so it doesn't repeat, **re-send until acknowledged** (escalation), whether it can break quiet hours, and where it goes: desktop, sound, phone (ntfy) and/or team webhook. Templates cover the common ones.
- **Alert inbox:** monitor hits sit at the top of the Alerts tab and in the dashboard's Active Situations until someone **acknowledges** them, from any window. Click one to see it on the map. Acknowledged hits are kept as history.
- **Desktop notifications** (Windows, macOS, Linux) for serious reports, with their own threshold.
- **Team webhooks:** Slack, Discord, Microsoft Teams, or plain JSON to any https endpoint, with their own threshold.

**Team chat** (Team tab, or Pop out → Team chat)
- **ntfy channels** (internet): a group chat on an ntfy topic. Free, no accounts. Teammates join from Vigilance or just read and reply in the free **ntfy** phone app. On the public ntfy.sh server the topic name is the only lock, so the app makes a long random one; for a private team, run your own ntfy server and add an access token.
- **Meshtastic channels** (off-grid radio): connect a Meshtastic LoRa radio to the laptop by **Bluetooth, USB cable or local Wi-Fi** and chat with the team over the mesh, with no cell service or internet. Messages are encrypted with the channel key on the radio (about 200 characters each). Teammates' radios that share GPS show up on the map as **team positions**.
- **Invites:** every channel has an **Invite** button with **QR codes** and a link. Copy it, email it, text it or use the system share sheet. For ntfy, the second QR opens the topic in the ntfy app (no Vigilance needed). For Meshtastic, paste the channel's share link from the Meshtastic app into the channel settings; the invite then includes it so teammates' radios join the encrypted channel. To join, paste any invite link, `VG1.` code, ntfy topic URL or Meshtastic channel link into **Join with an invite**. Invite links open the hosted web app at https://r0n1n9.github.io/vigilante/ (published by `.github/workflows/pages.yml`; turn it on once in Settings → Pages → Source: GitHub Actions).
- **Phone check-in (live team tracking):** the channel's **Invite** shows a **phone QR code**. A teammate scans it with their phone camera and it opens a page in their browser, with nothing to install. From there they can:
  - chat with the team
  - tap **SOS**, **Backup**, **On scene** or **All clear**
  - turn on **Share my location** for 1 to 12 hours

  Their position then shows live on the console's map, with a short trail, and in the dashboard's **Team** panel with accuracy, speed, battery and last-seen time. **SOS** and **Backup** become alerts that stay in the inbox until acknowledged.

  Locations are **encrypted end to end** (AES-256-GCM) with a key that travels only inside the invite, so the ntfy server sees only scrambled data. Sharing is always opt-in, stops on a timer or with **Stop sharing**, and disappears from the console when stopped.

  **Vigil app (Android):** Vigil phones join the same way: scan the phone QR code in Vigil, or tap **Open this team in Vigil** on the check-in page (`vigil://join?code=…`). Each person picks what to share: **location, battery, motion, heart rate, environment sensors**. The console shows only those categories and discards anything else. Someone can be on the roster with location switched off. **Go dark** (stealth) wipes their marker and trail from the console at once and lists them as DARK. The console's **📍 Request check-in** asks every phone for a fresh update: phones that are sharing answer right away, and the others ask their owner first. The wire format, encryption and test vectors for Vigil are in [`docs/TEAM_PROTOCOL.md`](docs/TEAM_PROTOCOL.md).

  Phone browsers pause location when the page is in the background, so the page keeps the screen awake while sharing. For all-day background tracking, use a Meshtastic radio (or, later, the Android app).
- **Waypoints for agents:** right-click the map → **Place waypoint for agents**, or use **Place waypoint** in the Team view. Name it, add a note, mark it routine or urgent, and send it to everyone or to chosen agents. It's encrypted with the channel key on its own ops topic. Agents get a prompt in Vigil, or a card on the phone check-in page, with **Directions** that opens their maps app. They reply **Acknowledged / En route / Arrived / Can't make it**, and the console also marks someone arrived when their GPS is within 40 m. The map shows the waypoint and dashed lines from assigned agents. Click it for each agent's status, then **Mark complete**, **Cancel** or **Resend**. The wire format is in [`docs/TEAM_PROTOCOL.md`](docs/TEAM_PROTOCOL.md) §4.
- **Push-to-talk voice:**
  - The console, Vigil and the phone page can talk to each other like walkie-talkies.
  - On the console, hold **PTT** in the top bar, the big button in the Team view, or the **V** key. On the phone page, hold **Hold to talk**. Release to send.
  - Everyone on the channel hears it about a second later, with a radio chirp. Recent clips can be replayed.
  - Audio is 8 kHz µ-law, encrypted with the channel key, and sent as an ntfy attachment on its own topic (`docs/TEAM_PROTOCOL.md` §4b).
  - The microphone is used only while you hold the button, and closes 30 s after your last transmission.
  - It works through any ntfy server that allows attachments, such as ntfy.sh. It doesn't work over Meshtastic, which has too little bandwidth for audio.
- **Pings and marks:** right-click the map for **Ping here**, **Add marker**, **Investigate (?)**, **Area of interest** or **Objective**, or use **Add mark** in the Team view.
  - Every mark has a category (hazard, entry point, rally point, observation, vehicle, activity, medical, staging, general), a name and a description of what's being marked.
  - Areas have a radius. Objectives move through Active → In progress → Done.
  - **Investigate** puts a "?" on a place someone should go and look at. Whoever goes taps **I'll check it**, so the team sees who's on it. They then **Resolve** it with what they found, and it can be reopened.
  - Pings pulse on the map and expire after 15 minutes.
  - Agents can place marks too: Vigil, or the phone page's **Ping my location** and **Mark this spot…**. Everyone sees every mark, with **Directions** to it.
  - Anyone can clear a mark, and a marker can be turned into a waypoint with **Send agents here**.
  - Descriptions should cover things and activity, not who someone is.
- **Share to team:** ⇪ buttons on alerts, developing incidents, monitor hits and the aircraft card, plus **right-click the map → Share this spot**. Messages with a spot get a "Show on map" button; spots from teammates also appear as team positions.
- **Auto-post:** each channel can also post new reports at or above a chosen level, so the whole team sees serious alerts.

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

Then open http://localhost:5173. Pop-outs open as new browser tabs. For the hosted web build, see [Web app and embedding](#web-app-and-embedding).

## Web app and embedding

The same app also builds for the web, so it can run in a browser tab or be dropped into any website the way a live map widget is. It's the same `src/` code with its own Vite target in [`web/`](web/).

```bash
npm run dev:web       # http://localhost:5180 (uses the local /proxy)
npm run build:web     # -> dist-web/: index.html, embed.html, embed.js, _headers
npm run preview:web   # serve dist-web/ with the production security headers
```

### What's different on the web

| | Desktop app | Web app |
|---|---|---|
| Data sources | Rust core | The CORS proxy Worker in [`web/proxy/`](web/proxy/) (same host allowlist, GET only) |
| Settings, watch areas, saved places | Settings files | This browser's local storage |
| Phone alerts (ntfy) | Rust core | Straight from the browser (ntfy allows CORS) |
| Monitors and alert inbox | Settings files | This browser's local storage |
| Desktop notifications | OS notifications (Tauri plugin) | Browser notifications, after the visitor allows them |
| Team webhooks (Slack, Teams, Discord, JSON) | Rust core | Desktop only. Slack and Teams refuse posts from web pages, and the proxy stays GET-only rather than relaying to arbitrary URLs. |
| AI briefing, AIS ships | Optional key, kept in the core | Only with the visitor's own key, which stays in their browser; hidden otherwise |
| Drone Remote ID (Bluetooth/Wi-Fi) | Yes | No: browsers can't listen for it. The Drones tab says so. |
| Pop-outs | OS windows on any monitor | New browser tabs, kept in sync over BroadcastChannel |

AI briefings from the browser use Anthropic's `anthropic-dangerous-direct-browser-access` header with the visitor's own key and the same request as the desktop app. AISstream may refuse browser connections; the desktop app always works for ships.

### Deploy

1. **Proxy:** deploy the Cloudflare Worker: `cd web/proxy && npx wrangler deploy`. Details, origin locking and rate limits: [`web/proxy/README.md`](web/proxy/README.md).
2. **Site:** in GitHub, Settings → Pages → Source: *GitHub Actions*, and add an Actions variable `VITE_PROXY_URL` with the Worker URL. The [`Vigilance web app (GitHub Pages)`](.github/workflows/web.yml) workflow builds with the right base path (`/<repo>/`) and publishes on every push to `main`, or run it by hand.
3. Any static host works too: build with `VITE_BASE=/ VITE_PROXY_URL=https://... npm run build:web` and upload `dist-web/`. Cloudflare Pages and Netlify also apply `dist-web/_headers`.

No API keys are built into the bundle or stored in the repo.

### Embed it on a website

Paste one tag where the console should appear. It inserts a responsive, sandboxed `<iframe>`:

```html
<script src="https://r0n1n9.github.io/vigilante/embed.js" data-city="denver" data-view="dashboard" async></script>
```

| Attribute | Values | Default |
|---|---|---|
| `data-view` | `dashboard`, `map` | `dashboard` |
| `data-city` | `denver`, `atlanta`, or `lat,lon` (e.g. `39.7392,-104.9903`) | the visitor's last choice, else Denver |
| `data-theme` | `tactical`, `greenred`, `nightvision`, `amber`, `redlight`, `steel` | `tactical` |
| `data-height` | a CSS height: `640`, `640px`, `70vh` | `620px` |
| `data-target` | a CSS selector to fill instead of inserting after the tag | |

More examples:

```html
<!-- Map of Atlanta in amber -->
<script src="https://r0n1n9.github.io/vigilante/embed.js" data-city="atlanta" data-view="map" data-theme="amber" data-height="70vh" async></script>

<!-- Any US location -->
<script src="https://r0n1n9.github.io/vigilante/embed.js" data-city="40.0150,-105.2705" data-view="map" async></script>

<!-- Plain iframe, no script -->
<iframe src="https://r0n1n9.github.io/vigilante/embed.html?view=dashboard&city=denver&theme=nightvision"
        title="Vigilance" style="width:100%;height:620px;border:0" loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
```

`embed.html` (or `?embed=1` on the main page) is the compact mode: slim top bar, no pop-outs, settings or window controls, and a footer strip linking to the full app. Replace `r0n1n9.github.io/vigilante` with your own deployment. The **Get the app** button (phone icon in the top bar) shows the embed snippet for the site you're on.

**Headers.** The app sends a Content-Security-Policy with `frame-ancestors *` so any site can embed it ([`web/headers.ts`](web/headers.ts); written to `_headers` for Cloudflare Pages and Netlify, and sent by `preview:web`). GitHub Pages can't set headers, but it sends no `X-Frame-Options`, so embedding works there too, and the rest of the policy ships as a `<meta>` tag. The embed sets no cookies, has no logins and tracks no one.

### Get the app

The **Get the app** dialog (phone icon in the top bar, or the embed footer) links the full project on GitHub and the Android app, with QR codes drawn in the browser (the pinned `qrcode` package, no external QR service). The Android link lives in one constant, `MOBILE_APP` in [`src/lib/links.ts`](src/lib/links.ts); point it at the Play Store listing when that's live.

## Using it

### First-time setup (Settings ⚙)
1. **Optional keys.** Everything works without keys. Three extras have no keyless equivalent: Georgia 511 (Atlanta road incidents and traffic cameras, [511ga.org](https://511ga.org) → Developers), COtrip (Denver road incidents, [manage-api.cotrip.org](https://manage-api.cotrip.org)) AISstream.io (live ships near coasts, [aisstream.io](https://aisstream.io)) and a Claude API key for AI briefings on the dashboard ([console.anthropic.com](https://console.anthropic.com), billed per use, about a cent per briefing). Paste them into Settings → Optional keys.
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
Radio → ▶ plays a feed in a small in-app player window (Broadcastify's free public feed page, no account needed), which you can move to another monitor. You can run several at once. Rows marked BROWSE open Broadcastify's list for that area so you can pick any feed. Denver PD's radio is encrypted, so it can't be heard anywhere.

### Everything else
- **Change location** with the ◎ location button (top left): search any US city, address or ZIP, or press *Use my location*. Searched places are saved in the same menu. Denver and Atlanta have full local sources. Anywhere else gets the national sources (aircraft, weather, FAA, wildfires, power, news search, webcams), and places within ~60 km of Denver or Atlanta reuse that city's local news, radio and transit.
- **Data feed chip** (e.g. `8/10 LIVE`) shows how many of the 10 data sources are currently delivering. Click it to see each one. *off* means it needs a key, hardware or a supported city.
- **Brief (☀)** shows the latest situation brief, and **Refresh** rebuilds it.
- **Pop out ▾** opens any panel in its own window. Closing the main window closes them all.
- **Speaker icon** mutes or unmutes alert tones (it turns amber with a slash when muted).
- **Appearance** (Settings → Appearance): theme presets (Tactical cyan, Night vision, Amber CRT, Red low-light, Steel) or your own RGB accent, panel and background colors, plus panel opacity and the grid texture. Changes apply instantly in every window.

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
web/             Web build: Vite config, index/embed pages, embed.js loader, security headers
web/proxy/       Cloudflare Worker CORS proxy for the web build (same host allowlist)
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
- Crime and 311: [Denver Open Data](https://opendata-geospatialdenver.hub.arcgis.com/), [Atlanta Police open data](https://opendata.atlantapd.org/)
- Satellite fire: [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) · Radar: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) · Earthquakes and river cameras: [USGS](https://www.usgs.gov/) · River gauges: [NOAA NWPS](https://water.noaa.gov/) · Air quality: [Open-Meteo](https://open-meteo.com/) · Airports: [FAA NAS Status](https://nasstatus.faa.gov/) · Wanted: [FBI](https://www.fbi.gov/wanted)
- Ships (optional key): [AISstream.io](https://aisstream.io)
- AI briefings (optional key): [Claude API](https://www.anthropic.com/api)
- Scanner radio: [Broadcastify](https://www.broadcastify.com) (played through their own web player)
- News: station RSS feeds (Denver7, 9NEWS, FOX31, Denverite, CPR News, 11Alive, FOX 5 Atlanta, WSB-TV, Atlanta News First) and Google News search RSS. Headlines link to the original story.
- Phone alerts: [ntfy](https://ntfy.sh)

## Known limitations

- **Denver traffic is untested.** COtrip's incident format isn't public without a key, so the parser is deliberately tolerant. Denver cameras are blocked on finding COtrip's camera endpoint, which needs a key to look up. Atlanta (Georgia 511) follows 511's published format, and its camera snapshots were tested live.
- **Live TV** relies on YouTube embeds. Stations only stream live during newscasts and breaking news; otherwise use *Latest*. If a desktop webview refuses to play the embed, use the **Mini ↗** window.
- **Power outage coverage is partial.** ODIN only includes utilities that report to it. Around Denver that's United Power and CORE Electric, but not Xcel Energy, which serves most of the city. In Atlanta, Georgia Power and the EMCs don't report to it. Their own outage maps are one click away in the Power tab. Their internal map data feeds are undocumented, so the app doesn't use them.
- **Radio plays through Broadcastify's own player**, not a raw stream URL, to stay within their terms. The feed list is curated per city, and coverage circles are approximate.
- **Live fire-department dispatch** (structure fires and medical calls) isn't published as open data in Denver or Atlanta. Wildfires come from NIFC; structure fires and rescues come from local news and the radio.
- **Neither city publishes live 911 calls openly.** Crime data is filed reports, typically 1–2 days behind. Atlanta's old dispatch layer stopped updating in 2026 and exposed caller names and phone numbers, so it isn't used.
- **Ships (AIS) are untested** without a key, and only matter near coasts or large lakes.
- **MARTA has no alerts feed**, so Atlanta transit disruptions are inferred from late buses. Rail isn't covered: MARTA's rail data needs a separate key.
- **The brief and developing incidents only know what the app saw while it was running.** History is kept for 72 hours.
- **News places** come from a built-in neighborhood list. Stories that only say "Denver" aren't pinned, to avoid false precision.
- **"AGL" is approximate:** barometric altitude minus the city's elevation. Circling detection is a heuristic.
- **API keys are stored in a plain settings file** in the app data folder. Moving them to the OS keychain is planned.
- adsb.lol rate limits are dynamic. If ADS-B shows **ERR**, the app retries automatically.
- The content security policy is still disabled during development.

## Phones: iPhone and Android, no install

The **phone page** (`https://r0n1n9.github.io/vigilante/?view=field`) runs in any phone browser, iPhone included,
so teammates don't need the Vigil Android app:

- **Create a team** (team name + callsign) or **join** one by opening an invite link or QR code, or pasting it.
- **Invite people** from the phone: QR code, the phone's share sheet, or copy the link.
- Chat, SOS / backup / on-scene / all-clear, waypoints, pings and marks, and opt-in encrypted live location sharing.
- **Add to Home Screen** (Safari → Share on iPhone; browser menu on Android) to keep it like an app.

Teams made on the phone page, in Vigil or in Vigilance are the same kind of channel, so everyone can mix.

