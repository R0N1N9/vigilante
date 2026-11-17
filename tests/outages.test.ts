import { describe, expect, it } from 'vitest';
import { outageSeverity, parseOdin } from '../src/lib/outages';

const square = (x: number, y: number) => ({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[x, y], [x + 0.3, y], [x + 0.3, y + 0.3], [x, y + 0.3], [x, y]]]] } });

describe('ODIN outages', () => {
  it('sums by county, keeps counties touching the area, cleans utility names', () => {
    const o = parseOdin(
      {
        results: [
          { name: 'UNITED POWER, INC,19499', county: 'Adams', state: 'Colorado', metersaffected: 900, geom: square(-105.0, 39.7) as never },
          { name: 'UNITED POWER, INC,19499', county: 'Adams', state: 'Colorado', metersaffected: 250, geom: square(-105.0, 39.7) as never },
          { name: 'LA PLATA ELECTRIC ASSN, INC,10539', county: 'La Plata', state: 'Colorado', metersaffected: 40, geom: square(-108.0, 37.2) as never },
        ],
      },
      [-104.9903, 39.7392],
      25,
    );
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ county: 'Adams', customers: 1150, utilities: ['UNITED POWER'], severity: 2 });
  });
  it('severity scale', () => {
    expect([10, 150, 2000, 20000].map(outageSeverity)).toEqual([0, 1, 2, 3]);
  });
});
