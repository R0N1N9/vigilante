import { describe, expect, it } from 'vitest';
import { parseNewest, parseSocrataCrime, SOCRATA_CRIME, socrataCrimeUrl, socrataNewestUrl, socrataTime } from '../src/lib/crimeSources';
import { crimeRef } from '../src/lib/stability';
import { PACKS } from '../src/lib/packs';
import hosts from '../config/hosts.json';

describe('Socrata crime sources', () => {
  it('every crime city is wired to a pack and an allowed host', () => {
    const allowed = JSON.stringify(hosts);
    for (const [id, s] of Object.entries(SOCRATA_CRIME)) {
      expect(PACKS.find((p) => p.id === id)?.intel.crime).toBe(id);
      expect(allowed).toContain(`"${s.domain}"`);
    }
  });

  it('builds a 7-day window ending at the newest record', () => {
    const s = SOCRATA_CRIME['new-york'];
    const u = new URL(socrataCrimeUrl(s, Date.parse('2026-09-30T00:00:00Z')));
    expect(u.hostname).toBe('data.cityofnewyork.us');
    expect(u.searchParams.get('$where')).toBe("cmplnt_fr_dt >= '2026-09-23T00:00:00' AND law_cat_cd = 'FELONY'");
    expect(u.searchParams.get('$order')).toBe('cmplnt_fr_dt DESC');
    expect(u.searchParams.get('$limit')).toBe('6000');
    const d = new URL(socrataCrimeUrl(SOCRATA_CRIME.dallas, Date.parse('2026-11-17T00:00:00Z')));
    expect(d.searchParams.get('$where')).toBe("date1 >= '2026-11-10'");
    expect(new URL(socrataNewestUrl(SOCRATA_CRIME.chicago)).searchParams.get('$select')).toBe('max(date) as newest');
  });

  it('reads dates with and without separate time columns', () => {
    expect(socrataTime('2026-11-10T13:45:00.000')).toBe(new Date(2026, 10, 10, 13, 45).getTime());
    expect(socrataTime('2026-11-17 00:00:00.0000000', '3:08')).toBe(new Date(2026, 10, 17, 3, 8).getTime());
    expect(socrataTime('')).toBe(0);
    expect(parseNewest([{ newest: '2026-11-10T00:00:00.000' }])).toBe(new Date(2026, 10, 10).getTime());
    expect(parseNewest([])).toBe(0);
  });

  it('parses rows, drops withheld locations, reads location columns', () => {
    const sea = parseSocrataCrime('seattle', SOCRATA_CRIME.seattle, [
      { offense_date: '2026-11-17T02:00:00.000', offense_sub_category: 'ROBBERY', nibrs_offense_code_description: 'Robbery', block_address: '1XX BLOCK OF PINE ST', neighborhood: 'DOWNTOWN', latitude: '47.61', longitude: '-122.33' },
      { offense_date: '2026-11-17T03:00:00.000', offense_sub_category: 'ASSAULT', latitude: 'REDACTED', longitude: 'REDACTED' },
    ]);
    expect(sea).toHaveLength(1);
    expect(sea[0]).toMatchObject({ category: 'Robbery', address: '1xx Block Of Pine St', neighborhood: 'Downtown', location: [-122.33, 47.61] });
    const dal = parseSocrataCrime('dallas', SOCRATA_CRIME.dallas, [
      { date1: '2026-11-17T00:00:00.000', time1: '22:15', offincident: 'AGG ASSAULT - FV WITH FIREARM', incident_address: '100 MAIN ST', geocoded_column: { latitude: '32.78', longitude: '-96.80' } },
    ]);
    expect(dal[0]).toMatchObject({ location: [-96.8, 32.78], firearm: true, at: new Date(2026, 10, 17, 22, 15).getTime() });
    expect(dal[0].severity).toBeGreaterThanOrEqual(2);
    expect(parseSocrataCrime('x', SOCRATA_CRIME.dallas, { error: true })).toEqual([]);
  });

  it('measures recent windows from the newest report, not the clock', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    expect(crimeRef([{ at: now - 8 * 86_400_000 }, { at: now - 9 * 86_400_000 }], now)).toBe(now - 8 * 86_400_000);
    expect(crimeRef([], now)).toBe(now);
    expect(crimeRef([{ at: now + 5000 }], now)).toBe(now);
  });
});
