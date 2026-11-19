/**
 * OpenMHz: public, key-free recordings of trunked police/fire/EMS radio calls, posted seconds
 * after each transmission. Played back to back, they work as a live scanner (same as Vigil).
 */
export interface OmhzSystem {
  shortName: string;
  name: string;
  city?: string;
  county?: string;
  state?: string;
  active?: boolean;
  callAvg?: number;
  clientCount?: number;
  description?: string;
}

export interface OmhzCall {
  id: string;
  url: string;
  at: number;
  len: number;
  talkgroup: number;
  emergency: boolean;
}

const API = 'https://api.openmhz.com';
export const systemsUrl = () => `${API}/systems`;
export const callsUrl = (sys: string) => `${API}/${encodeURIComponent(sys)}/calls`;
/** Calls after `timeMs`; keep the milliseconds or the last call comes back again. */
export const newerUrl = (sys: string, timeMs: number) => `${API}/${encodeURIComponent(sys)}/calls/newer?time=${timeMs}`;
export const talkgroupsUrl = (sys: string) => `${API}/${encodeURIComponent(sys)}/talkgroups`;
export const systemPage = (sys: string) => `https://openmhz.com/system/${encodeURIComponent(sys)}`;

export function parseSystems(j: unknown): OmhzSystem[] {
  const list = (j as { systems?: unknown[] })?.systems ?? (Array.isArray(j) ? j : []);
  return (list as Record<string, unknown>[])
    .filter((s) => typeof s.shortName === 'string')
    .map((s) => ({
      shortName: s.shortName as string,
      name: String(s.name ?? s.shortName),
      city: typeof s.city === 'string' ? s.city : undefined,
      county: typeof s.county === 'string' ? s.county : undefined,
      state: typeof s.state === 'string' ? s.state : undefined,
      active: s.active !== false,
      callAvg: Number(s.callAvg) || 0,
      clientCount: Number(s.clientCount) || 0,
      description: typeof s.description === 'string' ? s.description : undefined,
    }));
}

export function parseCalls(j: unknown): OmhzCall[] {
  const list = (j as { calls?: unknown[] })?.calls ?? (Array.isArray(j) ? j : []);
  return (list as Record<string, unknown>[])
    .map((c) => ({
      id: String(c._id ?? c.id ?? ''),
      url: String(c.url ?? ''),
      at: Date.parse(String(c.time ?? '')) || 0,
      len: Number(c.len) || 0,
      talkgroup: Number(c.talkgroupNum) || 0,
      emergency: !!c.emergency,
    }))
    .filter((c) => c.id && /^https:\/\//.test(c.url) && c.at)
    .sort((a, b) => a.at - b.at);
}

export function parseTalkgroups(j: unknown): Record<number, string> {
  const tg = (j as { talkgroups?: Record<string, { num?: number; alpha?: string; description?: string }> })?.talkgroups ?? {};
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(tg)) out[Number(v?.num ?? k)] = String(v?.description || v?.alpha || k);
  return out;
}

const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
/** OpenMHz lists states either as codes ("CO") or names ("Colorado"). */
const STATES = Object.fromEntries('Alabama AL,Alaska AK,Arizona AZ,Arkansas AR,California CA,Colorado CO,Connecticut CT,Delaware DE,District of Columbia DC,Florida FL,Georgia GA,Hawaii HI,Idaho ID,Illinois IL,Indiana IN,Iowa IA,Kansas KS,Kentucky KY,Louisiana LA,Maine ME,Maryland MD,Massachusetts MA,Michigan MI,Minnesota MN,Mississippi MS,Missouri MO,Montana MT,Nebraska NE,Nevada NV,New Hampshire NH,New Jersey NJ,New Mexico NM,New York NY,North Carolina NC,North Dakota ND,Ohio OH,Oklahoma OK,Oregon OR,Pennsylvania PA,Rhode Island RI,South Carolina SC,South Dakota SD,Tennessee TN,Texas TX,Utah UT,Vermont VT,Virginia VA,Washington WA,West Virginia WV,Wisconsin WI,Wyoming WY'.split(',').map((e) => [norm(e.slice(0, -3)), e.slice(-2).toLowerCase()]));
const stateCode = (s?: string) => STATES[norm(s)] ?? norm(s);

/** Active systems in the city's state, best first: city match, then activity. */
export function nearSystems(all: OmhzSystem[], place: { name: string; region: string }, limit = 8): OmhzSystem[] {
  const st = norm(place.region);
  const city = norm(place.name.split(',')[0]);
  const score = (s: OmhzSystem) =>
    (city && (norm(s.city) === city || norm(s.name).includes(city) || norm(s.county).includes(city)) ? 4 : 0) +
    Math.log10(1 + (s.callAvg ?? 0)) +
    Math.log10(1 + (s.clientCount ?? 0)) / 2;
  return all
    .filter((s) => s.active && stateCode(s.state) === st)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
