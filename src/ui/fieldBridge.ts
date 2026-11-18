/**
 * Hands the Field Agent page's ntfy events to the console engine (Now / Map tabs) once it's loaded,
 * so the phone keeps one connection per topic. Events received before the engine loads are replayed.
 */
type Kind = 'chat' | 'pos' | 'ops' | 'photo';
let sink: ((k: Kind, data: string) => void) | null = null;
const buffer: [Kind, string][] = [];

export function feedAgent(k: Kind, data: string) {
  if (sink) return sink(k, data);
  buffer.push([k, data]);
  if (buffer.length > 600) buffer.splice(0, buffer.length - 600);
}

export function setAgentSink(f: (k: Kind, data: string) => void) {
  sink = f;
  for (const [k, d] of buffer.splice(0)) f(k, d);
}
