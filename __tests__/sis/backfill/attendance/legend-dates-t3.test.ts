// __tests__/sis/backfill/attendance/legend-dates-t3.test.ts
import { describe, expect, it } from 'vitest';

import { parseLegendDateTextT3 } from '@/lib/sis/backfill/attendance/legend-dates-t3';

describe('parseLegendDateTextT3', () => {
  it('parses a single abbreviated-month date', () => {
    expect(parseLegendDateTextT3('26-Aug', 2026)).toEqual(['2026-08-26']);
  });

  it('parses a comma-separated list of days sharing a trailing full month name', () => {
    expect(parseLegendDateTextT3('13, 20, 27 July', 2026)).toEqual([
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
    ]);
  });

  it('parses a day range sharing a trailing full month name', () => {
    expect(parseLegendDateTextT3('14-16 July', 2026)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseLegendDateTextT3('  9-Aug  ', 2026)).toEqual(['2026-08-09']);
  });

  it('resolves the year boundary correctly for a December date', () => {
    expect(parseLegendDateTextT3('3-Dec', 2026)).toEqual(['2026-12-03']);
  });

  it('returns an empty array for an unrecognized shape', () => {
    expect(parseLegendDateTextT3('sometime in August', 2026)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseLegendDateTextT3('', 2026)).toEqual([]);
  });
});
