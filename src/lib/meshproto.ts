/**
 * Minimal Meshtastic protobuf codec: just what a team chat and position map
 * need. Field numbers follow meshtastic/protobufs (mesh.proto, portnums.proto),
 * checked against @meshtastic/protobufs 2.7.
 */
import { fields, str, Writer, type Field } from './protobuf';

export const BROADCAST = 0xffffffff;
export const PORT = { TEXT: 1, POSITION: 3, NODEINFO: 4 } as const;

export interface MeshUser {
  id: string;
  longName: string;
  shortName: string;
}
export interface MeshPosition {
  lat: number;
  lon: number;
  altM: number | null;
  time: number | null; // epoch seconds
}
export interface MeshPacket {
  from: number;
  to: number;
  channel: number;
  id: number;
  rxTime: number | null;
  portnum: number | null;
  payload: Uint8Array | null;
  encrypted: boolean;
}
export type FromRadio =
  | { kind: 'packet'; packet: MeshPacket }
  | { kind: 'myInfo'; myNodeNum: number }
  | { kind: 'nodeInfo'; num: number; user: MeshUser | null; position: MeshPosition | null; lastHeard: number | null }
  | { kind: 'channel'; index: number; name: string; role: number }
  | { kind: 'configComplete'; id: number }
  | { kind: 'other'; field: number };

const u32 = (f: Field) => f.fixed?.getUint32(0, true) ?? 0;
const i32 = (f: Field) => f.fixed?.getInt32(0, true) ?? 0;
const int32 = (f: Field) => {
  const v = f.varint ?? 0;
  return v >= 2 ** 31 ? v - 2 ** 64 : v; // negative int32 is sign-extended to 64 bits
};

export function decodeUser(b: Uint8Array): MeshUser {
  const u: MeshUser = { id: '', longName: '', shortName: '' };
  for (const f of fields(b)) {
    if (f.no === 1) u.id = str(f);
    else if (f.no === 2) u.longName = str(f);
    else if (f.no === 3) u.shortName = str(f);
  }
  return u;
}

export function decodePosition(b: Uint8Array): MeshPosition | null {
  let lat: number | null = null;
  let lon: number | null = null;
  let alt: number | null = null;
  let time: number | null = null;
  for (const f of fields(b)) {
    if (f.no === 1) lat = i32(f) / 1e7;
    else if (f.no === 2) lon = i32(f) / 1e7;
    else if (f.no === 3) alt = int32(f);
    else if (f.no === 4) time = u32(f) || null;
  }
  if (lat == null || lon == null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, altM: alt, time };
}

function decodePacket(b: Uint8Array): MeshPacket {
  const p: MeshPacket = { from: 0, to: 0, channel: 0, id: 0, rxTime: null, portnum: null, payload: null, encrypted: false };
  for (const f of fields(b)) {
    if (f.no === 1) p.from = u32(f);
    else if (f.no === 2) p.to = u32(f);
    else if (f.no === 3) p.channel = f.varint ?? 0;
    else if (f.no === 4 && f.bytes) {
      for (const d of fields(f.bytes)) {
        if (d.no === 1) p.portnum = d.varint ?? null;
        else if (d.no === 2) p.payload = d.bytes ?? null;
      }
    } else if (f.no === 5) p.encrypted = true;
    else if (f.no === 6) p.id = u32(f);
    else if (f.no === 7) p.rxTime = u32(f) || null;
  }
  return p;
}

export function decodeFromRadio(b: Uint8Array): FromRadio {
  for (const f of fields(b)) {
    if (f.no === 2 && f.bytes) return { kind: 'packet', packet: decodePacket(f.bytes) };
    if (f.no === 3 && f.bytes) {
      let n = 0;
      for (const g of fields(f.bytes)) if (g.no === 1) n = g.varint ?? 0;
      return { kind: 'myInfo', myNodeNum: n };
    }
    if (f.no === 4 && f.bytes) {
      let num = 0;
      let user: MeshUser | null = null;
      let position: MeshPosition | null = null;
      let lastHeard: number | null = null;
      for (const g of fields(f.bytes)) {
        if (g.no === 1) num = g.varint ?? 0;
        else if (g.no === 2 && g.bytes) user = decodeUser(g.bytes);
        else if (g.no === 3 && g.bytes) position = decodePosition(g.bytes);
        else if (g.no === 5) lastHeard = u32(g) || null;
      }
      return { kind: 'nodeInfo', num, user, position, lastHeard };
    }
    if (f.no === 10 && f.bytes) {
      let index = 0;
      let name = '';
      let role = 0;
      for (const g of fields(f.bytes)) {
        if (g.no === 1) index = g.varint ?? 0;
        else if (g.no === 2 && g.bytes) {
          for (const h of fields(g.bytes)) if (h.no === 3) name = str(h);
        } else if (g.no === 3) role = g.varint ?? 0;
      }
      return { kind: 'channel', index, name, role };
    }
    if (f.no === 7) return { kind: 'configComplete', id: f.varint ?? 0 };
    if (f.no !== 1) return { kind: 'other', field: f.no };
  }
  return { kind: 'other', field: 0 };
}

const randId = () => (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;

/** ToRadio asking the node to send its config, node list and channels. */
export const encodeWantConfig = (id: number) => new Writer().uint(3, id).finish();

/** ToRadio keep-alive (serial links time out after 15 minutes without one). */
export const encodeHeartbeat = () => new Writer().empty(7).finish();

/** ToRadio carrying a text message to everyone on a channel. */
export function encodeText(text: string, channel = 0, to = BROADCAST): { bytes: Uint8Array; id: number } {
  const id = randId();
  const data = new Writer().uint(1, PORT.TEXT).string(2, text);
  const packet = new Writer().fixed32(2, to).uint(3, channel).message(4, data).fixed32(6, id).uint(9, 3).uint(10, 1);
  return { bytes: new Writer().message(1, packet).finish(), id };
}

/** Meshtastic text messages are limited to about 200 bytes. */
export const MESH_TEXT_MAX = 200;

export const nodeIdOf = (num: number) => `!${(num >>> 0).toString(16).padStart(8, '0')}`;
