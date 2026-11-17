/**
 * Open Drone ID (ASTM F3411 / FAA Remote ID) message decoder.
 *
 * Drones broadcast these 25-byte messages over Bluetooth and Wi-Fi. Over
 * Bluetooth legacy advertising they arrive as service data for UUID 0xFFFA:
 *   [0x0D app code][counter][25-byte message]
 * A message pack (type 0xF) bundles several messages in one frame.
 */

export const ODID_SERVICE_UUID = 0xfffa;
const MSG_SIZE = 25;

export type OdidMessage =
  | { type: 'basic'; idType: number; uaType: number; uasId: string }
  | {
      type: 'location';
      status: number;
      lat: number | null;
      lon: number | null;
      altGeoM: number | null;
      altBaroM: number | null;
      heightM: number | null;
      heightType: 'takeoff' | 'ground';
      speedMs: number | null;
      vspeedMs: number | null;
      directionDeg: number | null;
    }
  | { type: 'selfId'; text: string }
  | {
      type: 'system';
      operatorLat: number | null;
      operatorLon: number | null;
      operatorAltM: number | null;
      operatorLocationType: number;
    }
  | { type: 'operatorId'; operatorId: string }
  | { type: 'auth' };

export const UA_TYPES = [
  'Unspecified', 'Aeroplane', 'Helicopter/Multirotor', 'Gyroplane', 'Hybrid lift', 'Ornithopter', 'Glider', 'Kite',
  'Free balloon', 'Captive balloon', 'Airship', 'Parachute', 'Rocket', 'Tethered aircraft', 'Ground obstacle', 'Other',
];

const ascii = (b: Uint8Array) =>
  String.fromCharCode(...b)
    .replace(/\0.*$/s, '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();

const altitude = (raw: number): number | null => (raw === 0 ? null : raw * 0.5 - 1000);

function latLon(dv: DataView, off: number): number | null {
  const v = dv.getInt32(off, true);
  return v === 0 ? null : v * 1e-7;
}

export function decodeMessage(msg: Uint8Array): OdidMessage | null {
  if (msg.length < MSG_SIZE) return null;
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  const type = msg[0] >> 4;
  switch (type) {
    case 0x0:
      return { type: 'basic', idType: msg[1] >> 4, uaType: msg[1] & 0x0f, uasId: ascii(msg.subarray(2, 22)) };
    case 0x1: {
      const flags = msg[1];
      const ewBit = (flags >> 1) & 1;
      const speedMult = flags & 1;
      const dirRaw = msg[2];
      const spRaw = msg[3];
      const lat = latLon(dv, 5);
      const lon = latLon(dv, 9);
      return {
        type: 'location',
        status: flags >> 4,
        lat,
        lon,
        altBaroM: altitude(dv.getUint16(13, true)),
        altGeoM: altitude(dv.getUint16(15, true)),
        heightM: altitude(dv.getUint16(17, true)),
        heightType: (flags >> 2) & 1 ? 'ground' : 'takeoff',
        directionDeg: dirRaw > 179 && !ewBit ? null : dirRaw + (ewBit ? 180 : 0),
        speedMs: spRaw === 255 ? null : speedMult ? spRaw * 0.75 + 255 * 0.25 : spRaw * 0.25,
        vspeedMs: dv.getInt8(4) === 63 ? null : dv.getInt8(4) * 0.5,
      };
    }
    case 0x2:
      return { type: 'auth' };
    case 0x3:
      return { type: 'selfId', text: ascii(msg.subarray(2, 25)) };
    case 0x4:
      return {
        type: 'system',
        operatorLocationType: msg[1] & 0x03,
        operatorLat: latLon(dv, 2),
        operatorLon: latLon(dv, 6),
        operatorAltM: altitude(dv.getUint16(18, true)),
      };
    case 0x5:
      return { type: 'operatorId', operatorId: ascii(msg.subarray(2, 22)) };
    default:
      return null;
  }
}

/** Decode one 25-byte message or a message pack. */
export function decodeFrame(frame: Uint8Array): OdidMessage[] {
  if (frame.length < MSG_SIZE) return [];
  if (frame[0] >> 4 === 0xf) {
    const size = frame[1];
    const count = frame[2];
    if (size !== MSG_SIZE || count > 9) return [];
    const out: OdidMessage[] = [];
    for (let i = 0; i < count; i++) {
      const start = 3 + i * MSG_SIZE;
      const m = decodeMessage(frame.subarray(start, start + MSG_SIZE));
      if (m) out.push(m);
    }
    return out;
  }
  const m = decodeMessage(frame.subarray(0, MSG_SIZE));
  return m ? [m] : [];
}

/** Bluetooth service data for UUID 0xFFFA: [0x0D][counter][frame...]. */
export function decodeServiceData(data: Uint8Array): OdidMessage[] {
  if (data.length >= 2 + MSG_SIZE && data[0] === 0x0d) return decodeFrame(data.subarray(2));
  return decodeFrame(data);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---- Encoders (used by the simulator and tests) ----

function encAlt(m: number | null): number {
  return m == null ? 0 : Math.max(0, Math.min(65535, Math.round((m + 1000) * 2)));
}

export function encodeBasic(uasId: string, uaType = 2, idType = 1): Uint8Array {
  const b = new Uint8Array(MSG_SIZE);
  b[0] = 0x02; // type 0, protocol version 2
  b[1] = (idType << 4) | uaType;
  for (let i = 0; i < Math.min(20, uasId.length); i++) b[2 + i] = uasId.charCodeAt(i);
  return b;
}

export function encodeLocation(o: { lat: number; lon: number; altGeoM: number; heightM: number; speedMs: number; directionDeg: number; vspeedMs?: number }): Uint8Array {
  const b = new Uint8Array(MSG_SIZE);
  const dv = new DataView(b.buffer);
  const dir = ((Math.round(o.directionDeg) % 360) + 360) % 360;
  const ew = dir >= 180 ? 1 : 0;
  const fast = o.speedMs > 255 * 0.25;
  b[0] = 0x12;
  b[1] = (2 << 4) | (0 << 2) | (ew << 1) | (fast ? 1 : 0); // status 2 = airborne, height above takeoff
  b[2] = dir - (ew ? 180 : 0);
  b[3] = fast ? Math.round((o.speedMs - 255 * 0.25) / 0.75) : Math.round(o.speedMs / 0.25);
  dv.setInt8(4, Math.round((o.vspeedMs ?? 0) / 0.5));
  dv.setInt32(5, Math.round(o.lat * 1e7), true);
  dv.setInt32(9, Math.round(o.lon * 1e7), true);
  dv.setUint16(13, encAlt(o.altGeoM), true);
  dv.setUint16(15, encAlt(o.altGeoM), true);
  dv.setUint16(17, encAlt(o.heightM), true);
  return b;
}

export function encodeSystem(operatorLat: number, operatorLon: number): Uint8Array {
  const b = new Uint8Array(MSG_SIZE);
  const dv = new DataView(b.buffer);
  b[0] = 0x42;
  b[1] = 0x01; // live GNSS operator location
  dv.setInt32(2, Math.round(operatorLat * 1e7), true);
  dv.setInt32(6, Math.round(operatorLon * 1e7), true);
  return b;
}

export function encodePack(msgs: Uint8Array[]): Uint8Array {
  const b = new Uint8Array(3 + msgs.length * MSG_SIZE);
  b[0] = 0xf2;
  b[1] = MSG_SIZE;
  b[2] = msgs.length;
  msgs.forEach((m, i) => b.set(m, 3 + i * MSG_SIZE));
  return b;
}

export function wrapServiceData(frame: Uint8Array, counter: number): Uint8Array {
  const b = new Uint8Array(2 + frame.length);
  b[0] = 0x0d;
  b[1] = counter & 0xff;
  b.set(frame, 2);
  return b;
}
