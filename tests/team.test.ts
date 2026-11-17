import { describe, expect, it } from 'vitest';
import { agentStatus, ageText, teamBounds } from '../src/lib/team';
import { cleanProfile, newPosKey, openPosition, sealPosition } from '../src/lib/poscrypt';

describe('agent status', () => {
  const now = 1_000_000_000;
  it('online, stale, offline and dark', () => {
    expect(agentStatus({ at: now - 60_000 }, now)).toBe('online');
    expect(agentStatus({ at: now - 5 * 60_000 }, now)).toBe('stale');
    expect(agentStatus({ at: now - 30 * 60_000 }, now)).toBe('offline');
    expect(agentStatus({ at: now, dark: true }, now)).toBe('dark');
  });
  it('formats ages', () => {
    expect(ageText(45_000)).toBe('45s');
    expect(ageText(-5)).toBe('0s');
    expect(ageText(2 * 3600_000)).toBe('2h');
  });
  it('bounds the team with padding', () => {
    expect(teamBounds([])).toBeNull();
    expect(teamBounds([[-105, 39.7], [-104.9, 39.8]], 0)).toEqual([[-105, 39.7], [-104.9, 39.8]]);
    const [[w], [e]] = teamBounds([[-105, 39.7]])!;
    expect(e - w).toBeCloseTo(0.008);
  });
});

describe('contact profiles', () => {
  it('keeps valid fields and drops junk', () => {
    expect(cleanProfile({ role: '  Team lead ', phone: '+1 (303) 555-0100', email: 'a@b.co' })).toEqual({ role: 'Team lead', phone: '+1 (303) 555-0100', email: 'a@b.co' });
    expect(cleanProfile({ phone: 'call me', email: 'nope', role: '' })).toBeUndefined();
    expect(cleanProfile({ unit: 'x'.repeat(100) })!.unit).toHaveLength(40);
  });
  it('is shared only with the profile permission', async () => {
    const k = newPosKey();
    const base = { v: 1 as const, id: 'p', n: 'A', t: 1, s: 'on' as const, prof: { role: 'Medic', phone: '+13035550100' } };
    expect((await openPosition(k, await sealPosition(k, { ...base, perm: ['bat'] })))!.prof).toBeUndefined();
    expect((await openPosition(k, await sealPosition(k, { ...base, perm: ['profile'] })))!.prof).toEqual({ role: 'Medic', phone: '+13035550100' });
  });
});
