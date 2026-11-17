import { getState } from './store';

let ctx: AudioContext | null = null;

/** Short dispatch-style alert tone. Higher severity = higher, double beep. */
export function alertTone(severity: number) {
  if (getState().muted) return;
  try {
    ctx ??= new AudioContext();
    const beeps = severity >= 3 ? 2 : 1;
    const freq = severity >= 3 ? 1046 : 784;
    for (let i = 0; i < beeps; i++) {
      const t0 = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
  } catch {
    /* audio unavailable */
  }
}
