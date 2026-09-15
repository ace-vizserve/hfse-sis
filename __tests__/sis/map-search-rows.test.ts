/**
 * Tests for `mapSearchRows` — the RPC-rows → `CrossAyMatch` seam in
 * lib/sis/queries.ts.
 *
 * Replaces `merge-search-hits.test.ts`. That helper existed because the search
 * fanned out into one query per column per academic year and JavaScript had to
 * union, dedupe, sort and cap the result lists. Migration 160 moved all four
 * into SQL, so the helper is gone and this is what is left on the TS side.
 *
 * ⚠ WHAT THIS CANNOT COVER. The matching itself — prefix tsquery building,
 * token sanitisation, ranking, the ILIKE identifier branch, and the fallback
 * for an AY table that has no `fts` column — is plpgsql in migration 160 and
 * needs a live database. These tests pin the seam, not the search.
 */

import { describe, expect, it } from 'vitest';

import { mapSearchRows, type SearchRow } from '@/lib/sis/queries';

const row = (over: Partial<SearchRow> = {}): SearchRow => ({
  ay_code: 'AY2026',
  enrolee_number: 'E26-0042',
  student_number: '2024-0117',
  full_name: 'Tan Wei Ming',
  level: 'Primary Six',
  section: 'Patience',
  status: 'Enrolled',
  rank: 0.6,
  ...over,
});

describe('mapSearchRows', () => {
  it('renames the SQL columns to the shape the API already returned', () => {
    expect(mapSearchRows([row()])[0]).toEqual({
      ayCode: 'AY2026',
      enroleeNumber: 'E26-0042',
      studentNumber: '2024-0117',
      fullName: 'Tan Wei Ming',
      level: 'Primary Six',
      section: 'Patience',
      status: 'Enrolled',
      rank: 0.6,
    });
  });

  it('drops a row with no enrolee number, which is its identity', () => {
    expect(mapSearchRows([row({ enrolee_number: null })])).toEqual([]);
  });

  it('keeps an applicant, who has no student number yet', () => {
    const [match] = mapSearchRows([row({ student_number: null })]);
    expect(match.studentNumber).toBeNull();
    expect(match.enroleeNumber).toBe('E26-0042');
  });

  it('leaves a nameless row blank rather than inventing text for the screen', () => {
    expect(mapSearchRows([row({ full_name: null })])[0].fullName).toBe('');
  });

  it('preserves the order the function returned', () => {
    // Ranking happens in SQL. Re-sorting here is precisely the JS-side work
    // this change removed, so the mapper must not reorder.
    const rows = [
      row({ enrolee_number: 'E-1', rank: 0.1 }),
      row({ enrolee_number: 'E-2', rank: 0.9 }),
      row({ enrolee_number: 'E-3', rank: 0.5 }),
    ];
    expect(mapSearchRows(rows).map((m) => m.enroleeNumber)).toEqual([
      'E-1',
      'E-2',
      'E-3',
    ]);
  });

  it('defaults a null rank to zero rather than leaking null into the type', () => {
    expect(mapSearchRows([row({ rank: null })])[0].rank).toBe(0);
  });

  it('returns nothing for no rows', () => {
    expect(mapSearchRows([])).toEqual([]);
  });

  it('keeps a match from an older academic year', () => {
    // Cross-year lookup is the whole point of this search — a student found
    // under AY2025 must survive the mapping with that year intact.
    const [match] = mapSearchRows([row({ ay_code: 'AY2025' })]);
    expect(match.ayCode).toBe('AY2025');
  });
});
