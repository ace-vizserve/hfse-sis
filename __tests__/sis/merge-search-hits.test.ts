/**
 * Tests for `mergeSearchHits` — the pure union/dedupe/sort/cap helper in
 * `lib/sis/queries.ts` behind the cross-AY student search.
 *
 * The search was restructured from a single `.or()` call (whose raw-DSL
 * filter string a `,` or `(`/`)` in the query — e.g. "Tan, Wei Ming" —
 * corrupted, silently returning no matches) into one parameterized
 * `.ilike()` query per column, unioned client-side through this helper.
 */
import { describe, expect, it } from 'vitest';
import { mergeSearchHits } from '@/lib/sis/queries';

type Hit = { enroleeNumber: string | null; created_at?: string | null };

const hit = (
  enroleeNumber: string | null,
  created_at?: string | null
): Hit => ({
  enroleeNumber,
  created_at,
});

describe('mergeSearchHits', () => {
  it('unions lists and dedupes by enroleeNumber (first occurrence wins)', () => {
    const a = hit('E-001', '2026-01-01');
    const dupOfA = hit('E-001', '2026-01-01');
    const b = hit('E-002', '2026-02-01');
    const merged = mergeSearchHits([[a], [dupOfA, b]], 20);
    expect(merged).toHaveLength(2);
    expect(merged.map((h) => h.enroleeNumber).sort()).toEqual([
      'E-001',
      'E-002',
    ]);
    // The first-seen object is kept, not the duplicate from a later list.
    expect(merged.find((h) => h.enroleeNumber === 'E-001')).toBe(a);
  });

  it('drops rows without an enroleeNumber', () => {
    const merged = mergeSearchHits([[hit(null), hit('E-001')]], 20);
    expect(merged).toHaveLength(1);
    expect(merged[0].enroleeNumber).toBe('E-001');
  });

  it('sorts newest created_at first (null/missing dates last)', () => {
    const merged = mergeSearchHits(
      [
        [hit('E-old', '2025-05-05'), hit('E-none', null)],
        [hit('E-new', '2026-06-06')],
      ],
      20
    );
    expect(merged.map((h) => h.enroleeNumber)).toEqual([
      'E-new',
      'E-old',
      'E-none',
    ]);
  });

  it('caps the merged result at the limit AFTER sorting', () => {
    const merged = mergeSearchHits(
      [
        [hit('E-1', '2026-01-01'), hit('E-2', '2026-02-01')],
        [hit('E-3', '2026-03-01')],
      ],
      2
    );
    expect(merged.map((h) => h.enroleeNumber)).toEqual(['E-3', 'E-2']);
  });

  it('handles empty input', () => {
    expect(mergeSearchHits([], 20)).toEqual([]);
    expect(mergeSearchHits([[], []], 20)).toEqual([]);
  });
});
