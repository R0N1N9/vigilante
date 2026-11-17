import { buildBrief } from '../../lib/brief';
import { getPack, placesOf } from '../../lib/packs';
import { localMinutes } from '../../lib/rules';
import { publishData } from '../bus';
import { getState, setState } from '../store';
import { ctx, getHistory, log, pushText } from './core';

export function makeBrief(hours = getState().settings.brief.hours) {
  const pack = getPack(ctx.packId);
  const to = Date.now();
  const brief = buildBrief({
    packId: pack.id,
    packName: pack.name,
    tz: pack.timezone,
    from: to - hours * 3600_000,
    to,
    history: getHistory(),
    clusters: getState().clusters,
    places: placesOf(pack),
  });
  setState({ brief });
  publishData();
  return brief;
}

/** Check once a minute whether it's time for the scheduled brief. */
export function startBriefScheduler() {
  let lastDay = '';
  window.setInterval(() => {
    const s = getState().settings.brief;
    if (!s.enabled) return;
    const pack = getPack(ctx.packId);
    const [h, m] = s.time.split(':').map(Number);
    const now = Date.now();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: pack.timezone }).format(now);
    if (day === lastDay || localMinutes(now, pack.timezone) !== h * 60 + m) return;
    lastDay = day;
    const brief = makeBrief(s.hours);
    log(`BRIEF  ${brief.headline}`, 0);
    if (s.push) void pushText(`brief:${day}`, `${pack.name} brief`, brief.pushText, 'sunrise');
  }, 30_000);
}
