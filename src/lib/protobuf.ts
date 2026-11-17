/**
 * Minimal protobuf wire-format reader: just enough to decode GTFS-Realtime
 * feeds without pulling in a code generator.
 */
export type Field = { no: number; wire: number; varint?: number; bytes?: Uint8Array; fixed?: DataView };

export function readVarint(b: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    if (pos >= b.length) throw new Error('truncated varint');
    byte = b[pos++];
    // Multiply instead of shift so values above 2^31 (timestamps) stay exact.
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [result, pos];
}

export function* fields(b: Uint8Array): Generator<Field> {
  let pos = 0;
  while (pos < b.length) {
    let key: number;
    [key, pos] = readVarint(b, pos);
    const no = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let v: number;
      [v, pos] = readVarint(b, pos);
      yield { no, wire, varint: v };
    } else if (wire === 2) {
      let len: number;
      [len, pos] = readVarint(b, pos);
      yield { no, wire, bytes: b.subarray(pos, pos + len) };
      pos += len;
    } else if (wire === 5) {
      yield { no, wire, fixed: new DataView(b.buffer, b.byteOffset + pos, 4) };
      pos += 4;
    } else if (wire === 1) {
      yield { no, wire, fixed: new DataView(b.buffer, b.byteOffset + pos, 8) };
      pos += 8;
    } else throw new Error(`unsupported wire type ${wire}`);
  }
}

const dec = new TextDecoder();
export const str = (f: Field) => (f.bytes ? dec.decode(f.bytes) : '');
/** Signed int64 varint (e.g. delay) comes through as a large unsigned number when negative. */
export const int = (f: Field) => {
  const v = f.varint ?? 0;
  return v > 2 ** 53 ? v - 2 ** 64 : v;
};
export const float = (f: Field) => f.fixed?.getFloat32(0, true) ?? 0;

// ---- Writer (for tests and fixtures) ----

export class Writer {
  private parts: number[] = [];
  private varint(v: number) {
    while (v > 0x7f) {
      this.parts.push((v % 128) | 0x80);
      v = Math.floor(v / 128);
    }
    this.parts.push(v);
  }
  uint(no: number, v: number) {
    this.varint(no * 8);
    this.varint(v);
    return this;
  }
  bytes(no: number, b: Uint8Array) {
    this.varint(no * 8 + 2);
    this.varint(b.length);
    b.forEach((x) => this.parts.push(x));
    return this;
  }
  string(no: number, s: string) {
    return this.bytes(no, new TextEncoder().encode(s));
  }
  message(no: number, w: Writer) {
    return this.bytes(no, w.finish());
  }
  float(no: number, v: number) {
    this.varint(no * 8 + 5);
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.parts.push(dv.getUint8(i));
    return this;
  }
  finish() {
    return Uint8Array.from(this.parts);
  }
}
