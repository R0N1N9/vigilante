import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTfrs } from '../src/lib/tfr';

const wfs = JSON.parse(readFileSync(new URL('./fixtures/tfr-wfs.json', import.meta.url), 'utf8'));
const list = JSON.parse(readFileSync(new URL('./fixtures/tfr-list.json', import.meta.url), 'utf8'));

describe('tfr', () => {
  it('keeps only no-fly zones touching the area and joins the list details', () => {
    const t = parseTfrs(wfs, list, [-104.9903, 39.7392], 25);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: '6/9999', type: 'SECURITY', url: 'https://tfr.faa.gov/tfr3/?page=detail_6_9999' });
  });
  it('finds nothing for Atlanta in this fixture', () => {
    expect(parseTfrs(wfs, list, [-84.388, 33.749], 25)).toHaveLength(0);
  });
});
