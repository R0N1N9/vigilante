/**
 * Push-to-talk voice clips ("VGV1").
 *
 * Hold to talk, release to send. The clip is 8 kHz G.711 µ-law (radio quality,
 * about 8 KB per second), sealed with the team key (AES-256-GCM) and posted as
 * an ntfy attachment on `<topic>-voice`. The ntfy message text carries the
 * sealed metadata. Anyone with the invite hears it; the server sees only
 * ciphertext. No codec library is involved, so a phone browser, the desktop app
 * and Vigil (Kotlin) all decode it the same way.
 */
import { openJson, sealJson } from './poscrypt';

export const voiceTopic = (topic: string) => `${topic}-voice`;
export const VOICE_RATE = 8000;
export const MAX_CLIP_S = 30;
export const MIN_CLIP_MS = 300;

export interface VoiceMeta {
  v: 1;
  /** Clip id. */
  id: string;
  /** Callsign of the speaker and their device/install id. */
  n: string;
  byId: string;
  /** Recorded at (epoch ms) and length in ms. */
  t: number;
  ms: number;
  sr: 8000;
  c: 'mulaw';
}

export const sealVoiceMeta = (key: string, m: VoiceMeta) => sealJson(key, m, 'VGV1');
export async function openVoiceMeta(key: string, text: string): Promise<VoiceMeta | null> {
  const m = await openJson<VoiceMeta>(key, text, 'VGV1');
  if (!m || m.v !== 1 || typeof m.id !== 'string' || m.c !== 'mulaw' || m.sr !== VOICE_RATE) return null;
  return { ...m, id: m.id.slice(0, 40), n: String(m.n ?? '').slice(0, 32), byId: String(m.byId ?? '').slice(0, 40), ms: Math.max(0, Math.min(MAX_CLIP_S * 1000 + 1000, Number(m.ms) || 0)), t: Number(m.t) || 0 };
}

// ---------------------------------------------------------------- codec ---

/** ITU-T G.711 µ-law encoding of one 16-bit sample. */
export function mulawEncode(s: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (s < 0) {
    s = -s;
    sign = 0x80;
  }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

export function mulawDecode(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exp = (u >> 4) & 0x07;
  const mant = u & 0x0f;
  const s = (((mant << 3) + 0x84) << exp) - 0x84;
  return sign ? -s : s;
}

/**
 * Float samples at any rate → 8 kHz µ-law. Averages each output window (a
 * crude low-pass that keeps speech clear and stops aliasing hiss) and lifts
 * quiet recordings so a phone held at arm's length is still audible.
 */
export function encodeClip(input: Float32Array, inRate: number): Uint8Array {
  const ratio = inRate / VOICE_RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b && j < input.length; j++) sum += input[j];
    out[i] = sum / (b - a);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const gain = peak > 0.001 ? Math.min(4, 0.9 / peak) : 1;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = mulawEncode(Math.round(Math.max(-1, Math.min(1, out[i] * gain)) * 32767));
  return bytes;
}

/** 8 kHz µ-law → float samples at `outRate` (linear interpolation; browsers won't all play 8 kHz buffers). */
export function decodeClip(bytes: Uint8Array, outRate = 24000): Float32Array {
  const pcm = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) pcm[i] = mulawDecode(bytes[i]) / 32768;
  const ratio = outRate / VOICE_RATE;
  const out = new Float32Array(Math.floor(pcm.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i / ratio;
    const a = Math.floor(x);
    const f = x - a;
    out[i] = (pcm[a] ?? 0) * (1 - f) + (pcm[a + 1] ?? pcm[a] ?? 0) * f;
  }
  return out;
}

// ---------------------------------------------------------------- crypto ---

const keys = new Map<string, Promise<CryptoKey>>();
const keyOf = (k: string) => {
  let p = keys.get(k);
  if (!p) {
    const raw = Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (k.length % 4)) % 4)), (c) => c.charCodeAt(0));
    p = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keys.set(k, p);
  }
  return p;
};

/** Audio bytes → 12-byte IV ‖ AES-GCM ciphertext+tag. */
export async function sealAudio(key: string, audio: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(key), audio as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function openAudio(key: string, sealed: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < 29) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, await keyOf(key), sealed.slice(12)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- transport ---

export interface VoiceChannel {
  server: string;
  topic: string;
  token?: string;
  posKey: string;
}

/** Post a clip as an ntfy attachment; the message text is the sealed metadata. */
export async function sendClip(ch: VoiceChannel, meta: VoiceMeta, audio: Uint8Array): Promise<void> {
  const body = await sealAudio(ch.posKey, audio);
  const res = await fetch(`${ch.server.replace(/\/$/, '')}/${voiceTopic(ch.topic)}`, {
    method: 'PUT',
    headers: {
      Filename: 'ptt.vgv',
      'X-Message': await sealVoiceMeta(ch.posKey, meta),
      'X-Tags': 'vigilance-voice',
      ...(ch.token ? { Authorization: `Bearer ${ch.token}` } : {}),
    },
    body: body as BodyInit,
  });
  if (!res.ok) {
    const why = res.status === 413 ? 'clip too large for this server' : res.status === 400 ? 'this ntfy server doesn’t accept attachments' : `ntfy answered HTTP ${res.status}`;
    throw new Error(why);
  }
}

/** Fetch and decrypt a clip's audio from its attachment URL. */
export async function fetchClip(key: string, url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return openAudio(key, new Uint8Array(await res.arrayBuffer()));
}

// ---------------------------------------------------------------- audio I/O ---

let ctx: AudioContext | null = null;
/** One shared AudioContext, created/resumed inside a user gesture (iOS requires that). */
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}
export const audioReady = () => !!ctx && ctx.state === 'running';

/** Short radio chirp: rising at key-up, falling "roger beep" at the end. */
function chirp(c: AudioContext, at: number, up: boolean) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(up ? 1200 : 1600, at);
  o.frequency.linearRampToValueAtTime(up ? 1600 : 1000, at + 0.07);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + 0.09);
}

let queueEnd = 0;
/** Play a decoded clip after anything already queued; resolves when it finishes. */
export function playClip(audio: Uint8Array): Promise<void> {
  const c = audioCtx();
  const rate = 24000;
  const pcm = decodeClip(audio, rate);
  const buf = c.createBuffer(1, Math.max(1, pcm.length), rate);
  buf.getChannelData(0).set(pcm);
  const src = c.createBufferSource();
  src.buffer = buf;
  // A touch of band-pass makes it sound like a radio and hides µ-law grit.
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 250;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3400;
  src.connect(hp).connect(lp).connect(c.destination);
  const start = Math.max(c.currentTime + 0.05, queueEnd);
  chirp(c, start, true);
  src.start(start + 0.1);
  const end = start + 0.1 + buf.duration;
  chirp(c, end + 0.02, false);
  queueEnd = end + 0.15;
  return new Promise((res) => setTimeout(res, Math.max(0, (queueEnd - c.currentTime) * 1000)));
}

/**
 * Microphone recorder for push-to-talk. The microphone stays open for a short
 * while after the last transmission so the first word of the next one isn't
 * clipped, then it's released (the browser's mic indicator goes off).
 */
export class PttRecorder {
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private limit: ReturnType<typeof setTimeout> | null = null;
  /** Called if the clip hits MAX_CLIP_S while still held. */
  onLimit: (() => void) | null = null;

  get active() {
    return this.recording;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone here (it needs https).');
    const c = audioCtx();
    if (this.idle) clearTimeout(this.idle);
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      this.source = c.createMediaStreamSource(this.stream);
      this.node = c.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => {
        if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      this.source.connect(this.node);
      // Some engines only run the processor while it's connected to the output; it writes silence.
      this.node.connect(c.destination);
    }
    this.chunks = [];
    this.recording = true;
    this.startedAt = Date.now();
    this.limit = setTimeout(() => this.onLimit?.(), MAX_CLIP_S * 1000);
  }

  /** Stop and return the encoded clip, or null if it was too short. */
  stop(): { audio: Uint8Array; ms: number; t: number } | null {
    if (!this.recording) return null;
    this.recording = false;
    if (this.limit) clearTimeout(this.limit);
    const ms = Date.now() - this.startedAt;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const ch of this.chunks) {
      all.set(ch, o);
      o += ch.length;
    }
    this.chunks = [];
    this.idle = setTimeout(() => this.release(), 30_000);
    if (ms < MIN_CLIP_MS || !total) return null;
    return { audio: encodeClip(all, audioCtx().sampleRate), ms, t: this.startedAt };
  }

  release() {
    this.recording = false;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}

/** Parse an ntfy SSE event into the sealed metadata text and attachment URL. */
export function voiceEvent(data: string): { id: string; message: string; url: string; expires?: number } | null {
  try {
    const e = JSON.parse(data) as { id: string; event: string; message?: string; attachment?: { url: string; expires?: number } };
    if (e.event !== 'message' || !e.message || !e.attachment?.url) return null;
    return { id: e.id, message: e.message, url: e.attachment.url, expires: e.attachment.expires };
  } catch {
    return null;
  }
}
