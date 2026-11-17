import { describe, expect, it } from 'vitest';
import { BROADCAST, decodeFromRadio, encodeHeartbeat, encodeText, encodeWantConfig, nodeIdOf, PORT } from '../src/lib/meshproto';
import { fields, Writer } from '../src/lib/protobuf';

describe('meshtastic codec', () => {
  it('encodes a broadcast text as ToRadio.packet', () => {
    const { bytes, id } = encodeText('hello team', 1);
    const top = [...fields(bytes)];
    expect(top[0].no).toBe(1);
    const pkt = [...fields(top[0].bytes!)];
    const get = (n: number) => pkt.find((f) => f.no === n)!;
    expect(get(2).fixed!.getUint32(0, true)).toBe(BROADCAST);
    expect(get(3).varint).toBe(1);
    expect(get(6).fixed!.getUint32(0, true)).toBe(id);
    const data = [...fields(get(4).bytes!)];
    expect(data[0]).toMatchObject({ no: 1, varint: PORT.TEXT });
    expect(new TextDecoder().decode(data[1].bytes)).toBe('hello team');
  });

  it('encodes config request and heartbeat', () => {
    expect([...fields(encodeWantConfig(42))][0]).toMatchObject({ no: 3, varint: 42 });
    expect([...fields(encodeHeartbeat())][0]).toMatchObject({ no: 7 });
  });

  it('decodes FromRadio text packets, node info and channels', () => {
    const data = new Writer().uint(1, PORT.TEXT).string(2, 'copy that');
    const pkt = new Writer().fixed32(1, 0xa1b2c3d4).fixed32(2, BROADCAST).uint(3, 0).message(4, data).fixed32(6, 77).fixed32(7, 1700000000);
    const fr = decodeFromRadio(new Writer().uint(1, 5).message(2, pkt).finish());
    expect(fr.kind).toBe('packet');
    if (fr.kind !== 'packet') return;
    expect(fr.packet).toMatchObject({ from: 0xa1b2c3d4, to: BROADCAST, id: 77, rxTime: 1700000000, portnum: PORT.TEXT });
    expect(new TextDecoder().decode(fr.packet.payload!)).toBe('copy that');

    const user = new Writer().string(1, '!a1b2c3d4').string(2, 'Unit Seven').string(3, 'U7');
    const pos = new Writer().fixed32(1, 397392000).fixed32(2, -1049903000).uint(3, 1600).fixed32(4, 1700000000);
    const ni = decodeFromRadio(new Writer().message(4, new Writer().uint(1, 0xa1b2c3d4).message(2, user).message(3, pos).fixed32(5, 1700000100)).finish());
    expect(ni).toMatchObject({ kind: 'nodeInfo', num: 0xa1b2c3d4, user: { longName: 'Unit Seven', shortName: 'U7' }, lastHeard: 1700000100 });
    if (ni.kind === 'nodeInfo') {
      expect(ni.position!.lat).toBeCloseTo(39.7392, 4);
      expect(ni.position!.lon).toBeCloseTo(-104.9903, 4);
    }

    const ch = decodeFromRadio(new Writer().message(10, new Writer().uint(1, 1).message(2, new Writer().string(3, 'OPS')).uint(3, 2)).finish());
    expect(ch).toEqual({ kind: 'channel', index: 1, name: 'OPS', role: 2 });
    expect(decodeFromRadio(new Writer().uint(7, 99).finish())).toEqual({ kind: 'configComplete', id: 99 });
    expect(decodeFromRadio(new Writer().message(3, new Writer().uint(1, 1234)).finish())).toEqual({ kind: 'myInfo', myNodeNum: 1234 });
  });

  it('formats node ids', () => {
    expect(nodeIdOf(0xa1b2c3d4)).toBe('!a1b2c3d4');
    expect(nodeIdOf(5)).toBe('!00000005');
  });
});
