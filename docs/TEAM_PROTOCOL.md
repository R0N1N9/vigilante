# Vigilance team protocol (v1)

How a phone joins a Vigilance team, chats, and shares its location and sensor data with the console. The Vigilance web check-in page and the **Vigil** Android app both implement it. Vigilance's own implementation is in `src/lib/comms.ts`, `src/lib/poscrypt.ts` and `src/ui/FieldApp.tsx`; `tests/protocol.test.ts` checks the test vectors below.

Everything rides on **ntfy** (https://ntfy.sh or a self-hosted server): plain HTTPS, no accounts, no API key.

## 1. Invites

An invite is a string `VG1.<payload>`, where `<payload>` is unpadded base64url of UTF-8 JSON:

| Key | Meaning |
|---|---|
| `v` | `1` |
| `k` | `"ntfy"` (Meshtastic invites use `"mesh"`; phones without a radio can ignore them) |
| `n` | Channel name, up to 60 characters |
| `s` | ntfy server base URL; **must be `https://`** |
| `t` | Topic, `[A-Za-z0-9_-]{1,64}` |
| `p` | Position key: 32 random bytes, unpadded base64url (43 characters). Missing on older invites, so no location sharing for them |
| `a` | Optional ntfy access token (`tk_…`) for a protected topic |

Invites reach a phone in any of these forms. Find `VG1.` followed by `[A-Za-z0-9_-]+` anywhere in the text:

- `https://r0n1n9.github.io/vigilance/?view=field#join=VG1.…`: the phone check-in QR code. Opens the web page in a browser. Vigil's own QR scanner should accept it directly.
- `vigil://join?code=VG1.…`: the deep link the web page and the console offer for Vigil. **Vigil should register an intent filter for the `vigil` scheme, host `join`.**
- A bare `VG1.…` code pasted by hand.

Treat the whole invite as a secret: it holds the topic, the location key and maybe a token. Show the channel name and server, and ask the user to confirm before joining.

**Test vector:**
```
JSON:   {"v":1,"k":"ntfy","n":"North patrol","s":"https://ntfy.sh","t":"vg-team-k2m9x4q7r1p8w3z5c6","p":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"}
Invite: VG1.eyJ2IjoxLCJrIjoibnRmeSIsIm4iOiJOb3J0aCBwYXRyb2wiLCJzIjoiaHR0cHM6Ly9udGZ5LnNoIiwidCI6InZnLXRlYW0tazJtOXg0cTdyMXA4dzN6NWM2IiwicCI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHhBUkVoTVVGUllYR0JrYUd4d2RIaDgifQ
```

## 2. Chat (topic `t`)

**Receive:** subscribe with `GET {s}/{t}/json?since=<last message id or "12h">` (newline-delimited JSON stream) or `/sse`. Use messages where `event == "message"`. Fields: `id`, `time` (epoch seconds), `title` (sender callsign; missing for plain ntfy app users), `message` (text), `tags`, `click` (optional link).

**Send:** `POST {s}/` with `Content-Type: application/json` (plus `Authorization: Bearer <a>` if a token is set):
```json
{"topic":"<t>","title":"<callsign>","message":"<text>","tags":["vigilance","vg-<deviceId>"],
 "click":"https://www.openstreetmap.org/?mlat=<lat>&mlon=<lon>#map=16/<lat>/<lon>",
 "actions":[{"action":"view","label":"Map","url":"<same as click>"}]}
```
`click` and `actions` are only for messages that carry a location. The `vg-<deviceId>` tag is how a device recognises its own messages coming back. Messages from the Vigilance console also carry the tag **`vigilance-console`**, so phones can tell the control center from teammates without guessing.

**SOS location follow-up.** If an SOS goes out before the phone has a GPS fix, send the location afterwards as `"📍 SOS LOCATION — <callsign>"` with the map link. The console attaches it to that person's open SOS alert instead of raising a second one.

**Status codes.** A message whose text starts with one of these is a status. The console turns the first three into alerts that stay up until acknowledged:

| Text prefix | Meaning | Console |
|---|---|---|
| `🚨 EMERGENCY` | SOS | Critical alert, loud tone, desktop notification |
| `🚨 FALL DETECTED` | Fall detected by the phone | Critical alert |
| `⚠ NEED BACKUP` | Backup needed | Serious alert |
| `✓ ON SCENE` / `✓ ALL CLEAR` | Status only | Shown in chat |

Send them as `"<prefix> — <callsign>"` with the location link when location sharing is allowed.

**Check-in request (console → phones).** A chat message tagged `vigilance-ping` whose text starts with `📍 CHECK-IN REQUEST`. A phone that is sharing location should send one fresh report right away. A phone that isn't sharing should **ask its owner** and never answer silently.

## 3. Position and sensor reports (topic `t` + `-pos`)

Reports go on a sibling topic (`<t>-pos`) so people following the chat in the ntfy app don't get a notification for every update. Publish with the same `POST {s}/` JSON, `{"topic":"<t>-pos","message":"VGP1.…","tags":["vigilance-pos"]}`.

**Sealing.** AES-256-GCM, key = base64url-decode(`p`), a fresh random 12-byte IV per message, no associated data, 128-bit tag. `message = "VGP1." + base64url_nopad(iv ‖ ciphertext ‖ tag)`. The ntfy server only ever sees this ciphertext.

**Report JSON** (UTF-8, before sealing). Only `v`, `id`, `n`, `t` and `s` are required. Leave out anything the person hasn't allowed:

| Key | Type | Category | Meaning |
|---|---|---|---|
| `v` | 1 | | Version |
| `id` | string ≤ 40 | | Stable random id for this install (not hardware IDs) |
| `n` | string ≤ 32 | | Callsign |
| `t` | number | | Fix time, epoch **ms** |
| `s` | `"on"`/`"off"`/`"dark"` | | See states below |
| `app`, `ver` | string | | `"vigil"` and its version (the web page sends `"field"`) |
| `perm` | string[] | | Categories being shared **right now**: `loc`, `bat`, `motion`, `hr`, `env`, `profile` |
| `lat`, `lon` | number | `loc` | WGS-84 degrees (full precision: this is the opt-in exception to Vigil's 2-decimal rule) |
| `acc` | number | `loc` | Horizontal accuracy, m |
| `alt` | number | `loc` | Altitude, m |
| `spd`, `hdg` | number | `loc` | Speed m/s, heading degrees |
| `bat`, `chg` | number, bool | `bat` | Battery % and charging |
| `act` | string | `motion` | `still`, `walking`, `running`, `cycling`, `driving`, `unknown` |
| `hr` | number | `hr` | Heart rate, bpm, from a paired wearable |
| `env` | object | `env` | `lux` (light), `hpa` (pressure), `db` (noise level, never audio) |
| `prof` | object | `profile` | `role` (≤40), `unit` (≤40), `phone` (`+`, digits, spaces, `().-`), `email`. Shown on the console's agent profile with call, text and email buttons. Invalid values are dropped |

**The console enforces `perm`.** Fields outside the listed categories are thrown away on receipt, and a missing `perm` means `["loc"]`. A report without `loc` is still valid: the person shows as present, with no location.

**Console status.** The console shows an agent as **online** if it heard from them in the last 3 minutes, **stale** up to 15 minutes, then **offline**, and **dark** after a `dark` report. While sharing, send at least one report a minute so the agent stays online.

**States:**
- `on`: sharing. Send when moved more than 20 m (at most every 8 s), otherwise every 30 to 60 s as a heartbeat.
- `off`: stopped sharing. The console removes the person from the map and roster.
- `dark`: **stealth**. The console removes the marker and trail **immediately**, keeps no last position, and lists the person as "DARK". Send it once, with no location, when the user taps a stealth button, then send nothing. A fully silent stealth (sending nothing at all) is also fine; the console then just ages the person out.

**Test vector:**
```
Key (base64url):  AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
IV (hex):         a0a1a2a3a4a5a6a7a8a9aaab
Plaintext:        {"v":1,"id":"vigil-3f9a2c","n":"Unit 7","app":"vigil","ver":"1.2.0","perm":["loc","bat","motion"],"lat":39.7392,"lon":-104.9903,"acc":8,"spd":1.4,"hdg":92,"bat":76,"chg":false,"act":"walking","t":1763400000000,"s":"on"}
Sealed message:   VGP1.oKGio6SlpqeoqaqrnToKD3_6Lp0LAaXpJQypuRnAdCP0jiNe_ywKpBGJTyOHGC6LjxVxEX39dLgrQKGPLnwvJED8OAgkLClkhkGrgpqMp0MS1YGSmcDFQ62io9nvJ4nGpLW7VswYUe7Y9SO20qgJx2LaraGt4ihntrHfBAY8DsD8D7YNH_vwnY1lwWHncNMc8Xi4OxUqju8wcKD4vPWPA9q32LbE_5HXzaZACfwvKZ2UCShxoDBNQwOh081VR57sIFyMSePuHVAy5T17FkJu81Hmjd7HbXD_eRQChWLFxpsdWfrXg-MlOIQF2dum6Ojq4dYkz52Pmg
```

## 4. Waypoints (topic `t` + `-ops`)

The console sends **waypoints** (rally points, posts, places to check) to agents, and agents answer. Messages go on a third sibling topic, `<t>-ops`, sealed exactly like position reports (same key `p`, AES-256-GCM) but with the prefix **`VGO1.`** instead of `VGP1.`. Publish with `{"topic":"<t>-ops","message":"VGO1.…","tags":["vigilance-ops"]}`.

**Waypoint** (console → agents; a newer `t` replaces an older one with the same `id`):
```json
{"v":1,"type":"wp","id":"k3x9p2","name":"North gate","note":"Meet Bravo here","lat":39.748,"lon":-104.995,
 "to":["vigil-3f9a2c"],"pri":"urgent","state":"active","by":"Ops","t":1763400000000}
```
- `to`: device ids (the report `id` field) the waypoint is for. An **empty list means everyone** on the channel.
- `pri`: `routine` or `urgent`. `state`: `active`, `done` or `cancelled`. Stop showing a waypoint once it's no longer `active`.

**Reply** (agent → console):
```json
{"v":1,"type":"wp-ack","wp":"k3x9p2","id":"vigil-3f9a2c","n":"Unit 7","state":"enroute","t":1763400030000}
```
`state` is one of `ack`, `enroute`, `arrived`, `declined`. The console also marks an agent `arrived` on its own when their shared position is within 40 m of the waypoint.

**What Vigil should do:** show a notification for a new active waypoint addressed to this device ("Waypoint from Ops: North gate. Open directions"), and make `urgent` ones louder or vibrate. Tapping **Directions** should open turn-by-turn navigation:
- Android: `Intent(ACTION_VIEW, Uri.parse("google.navigation:q=<lat>,<lon>"))`.
- If no app handles that, fall back to `geo:<lat>,<lon>?q=<lat>,<lon>(<name>)`, which lets the user pick a maps app.

Send `enroute` when the user opens directions, and offer Acknowledged, Arrived and Can't make it buttons. A user in stealth (dark) mode still receives waypoints but sends no automatic replies.

### Marks (anyone → everyone, same `-ops` topic and `VGO1.` sealing)

Marks are shared map annotations. **Anyone on the team** can place, edit or clear one: the console, the web phone page or Vigil. A newer `t` with the same `id` replaces the older version.
```json
{"v":1,"type":"mark","id":"m7q2xk","kind":"area","cat":"hazard","name":"Downed power line",
 "desc":"Line across the alley behind the gym. Keep clear.","lat":39.748,"lon":-104.995,"r":150,
 "state":"active","by":"Unit 7","byId":"vigil-3f9a2c","t":1763400000000}
```
- `kind`:
  - `ping`: a quick "look here". It pulses on maps and disappears after `ttl` seconds (default **900**).
  - `marker`: a point of interest.
  - `area`: a circle of radius `r` meters, 10–20,000.
  - `objective`: a goal with a status.
  - `investigate`: a "?" on a place someone should go and look at. States read as `active` = Open, `progress` = Checking (by `by`) and `done` = Resolved. Put the findings in `res` (up to 500 characters) when resolving.
- `cat`: `general`, `hazard`, `entry`, `rally`, `observation`, `vehicle`, `activity`, `medical`, `staging`. Unknown values are shown as `general`.
- `state`: `active`, `progress` (objectives and investigate), `done`, or `cleared`, which removes the mark everywhere.
- `name` up to 60 characters, `desc` up to 500. `by` is the callsign. `byId` is the device id, or the console's install id.
- Prompt people to **describe things and activity, not who someone is**. Marks aren't for identifying or tracking individuals.

**Vigil suggestions:**
- Show marks on the map in their category color, with distance and **Go** (directions).
- Make a teammate's new ping vibrate briefly.
- Offer **Ping my location** as one tap.
- Offer **Mark this spot** with kind, category, name and description.
- Let anyone clear a mark.

## 4b. Push-to-talk voice (topic `t` + `-voice`)

Walkie-talkie style: **hold to talk, release to send**. Each transmission is one clip, posted as an ntfy **attachment**. Clips end to end usually take about 1 second after release. The server only ever sees ciphertext.

**Audio:** 8 kHz, mono, G.711 **µ-law**, one byte per sample (about 8 KB/s), at most 30 s. There's no codec library or container, just raw µ-law bytes, so browsers, the desktop app and Android all decode it the same way. On Android, `AudioRecord` at 8000 Hz PCM16 with a standard µ-law encoder produces the same bytes. Play with `AudioTrack`, after decoding µ-law to PCM16.

**Send:** `PUT https://<server>/<t>-voice`
- **Body:** `iv(12) ‖ AES-256-GCM(µ-law bytes)`, including the tag, using the channel key `p`. These are raw bytes, not base64.
- **Headers:**
  - `Filename: ptt.vgv`
  - `X-Message: VGV1.<sealed metadata>`, sealed exactly like `VGP1`/`VGO1`
  - `X-Tags: vigilance-voice`
  - `Authorization: Bearer <a>` if the invite has a token
- **Sealed metadata:**
```json
{"v":1,"id":"k3j9x0a1","n":"Unit 7","byId":"vigil-3f9a2c","t":1763400000000,"ms":2400,"sr":8000,"c":"mulaw"}
```

**Receive:** subscribe to `<t>-voice`, for example `/sse?since=1h`.
- Each message event has `message` (the sealed metadata) and `attachment.url`.
- Download the URL, decrypt it, decode it and play it.
- Auto-play only clips with `t` in the last ~90 s, and skip your own (`byId`). List older ones for replay.
- Play clips one after another, never overlapping.
- The apps play a short rising chirp before a clip and a falling "roger beep" after it.

**Limits:**
- The ntfy server must allow attachments. ntfy.sh does: 15 MB per file, and files are deleted after about 3 hours.
- ntfy.sh also caps attachment storage per visitor, roughly 100 MB a day. That's plenty for push-to-talk: 30 s is 240 KB.
- A self-hosted server needs `attachment-cache-dir` set.
- Voice isn't sent over Meshtastic: LoRa carries about 200 bytes per packet, which is far too little for audio.

## 5. Kotlin reference (Android API 26+)

```kotlin
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

private val b64 = Base64.getUrlEncoder().withoutPadding()
private val unb64 = Base64.getUrlDecoder()

fun sealPosition(keyB64: String, json: String): String {
    val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(unb64.decode(keyB64), "AES"), GCMParameterSpec(128, iv))
    return "VGP1." + b64.encodeToString(iv + c.doFinal(json.toByteArray(Charsets.UTF_8)))
}

fun openPosition(keyB64: String, message: String): String? {
    if (!message.startsWith("VGP1.")) return null
    return runCatching {
        val raw = unb64.decode(message.removePrefix("VGP1."))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(unb64.decode(keyB64), "AES"), GCMParameterSpec(128, raw, 0, 12))
        String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
    }.getOrNull()
}

fun parseInvite(text: String): String? =
    Regex("VG1\\.([A-Za-z0-9_-]+)").find(text)?.groupValues?.get(1)?.let { String(unb64.decode(it), Charsets.UTF_8) }
```

To check an implementation, `openPosition` with the test key must return the plaintext above exactly. `sealPosition` uses a random IV, so its output won't match byte for byte, but Vigilance must be able to open it.

## 6. What Vigil should give the user

These are suggestions for the Vigil side:

- A **separate switch per category** (location, battery, motion, heart rate, environment, contact profile), all **off by default**, each asking for its Android permission only when switched on. Background location needs `ACCESS_BACKGROUND_LOCATION` and a visible foreground-service notification (type `location`) while sharing.
- A one-tap **Stealth / Go dark** control: in the app, in the notification and ideally as a Quick Settings tile. It sends `dark` once, stops all reports and pauses check-in replies until the user turns sharing back on.
- An **auto-stop timer** (for example the end of a shift) and a clear "sharing with <channel>" indicator.
- Check-in requests always asking the user unless they chose "answer automatically while sharing".
- Leaving a team deletes the stored invite (key, topic, token).
- Rate limits: no more than one report every 8 s, and back off on HTTP 429 from ntfy.
