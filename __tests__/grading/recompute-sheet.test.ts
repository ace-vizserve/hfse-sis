/**
 * The shared sheet recompute. Two call sites depend on it — the per-sheet
 * totals route (which always had it) and the config-level fan-out (which
 * never did, leaving stored grades computed against old denominators).
 *
 * These tests pin the three properties the correctness argument rests on:
 * padding is null-not-zero, a no-op change writes nothing, and the patch
 * never touches operator-owned columns.
 */

import { describe, it, expect } from 'vitest';
import {
  padScores,
  recomputeEntryRow,
  type RecomputableEntry,
} from '@/lib/grading/recompute-sheet';

const WEIGHTS = { ww_weight: 0.4, pt_weight: 0.4, qa_weight: 0.2 };

describe('padScores', () => {
  it('pads with null, never zero — Hard Rule #3', () => {
    // A zero would enter both numerator and denominator and tank the grade.
    // A null is excluded from both, which is what "not taken" means.
    expect(padScores([10, 8], 4)).toEqual([10, 8, null, null]);
    expect(padScores([10, 8], 4)).not.toContain(0);
  });

  it('truncates when the totals array shrinks', () => {
    expect(padScores([10, 8, 6], 2)).toEqual([10, 8]);
  });

  it('handles a null or empty array', () => {
    expect(padScores(null, 2)).toEqual([null, null]);
    expect(padScores([], 2)).toEqual([null, null]);
  });

  it('preserves an existing null rather than coercing it', () => {
    expect(padScores([10, null, 6], 3)).toEqual([10, null, 6]);
  });
});

describe('recomputeEntryRow', () => {
  const totals = {
    ww_totals: [10, 10],
    pt_totals: [10, 10, 10],
    qa_total: 30,
  };

  // The canonical Hard Rule #1 case: this input must produce quarterly 93.
  const canonical: RecomputableEntry = {
    id: 'e-1',
    ww_scores: [10, 10],
    pt_scores: [6, 10, 10],
    qa_score: 22,
    ww_ps: 100,
    pt_ps: 86.6667,
    qa_ps: 73.3333,
    initial_grade: 89.3333,
    quarterly_grade: 93,
  };

  it('reproduces the canonical grade', () => {
    const { patch } = recomputeEntryRow(canonical, totals, WEIGHTS);
    expect(patch.quarterly_grade).toBe(93);
  });

  it('reports no change when stored values already match', () => {
    const { changed } = recomputeEntryRow(canonical, totals, WEIGHTS);
    expect(changed).toBe(false);
  });

  it('adding an empty slot moves no grade, so nothing is written beyond the resize', () => {
    // The common coordinator action — extending ww_max_slots by one. The
    // array has to grow, but a null slot is excluded from both sums, so the
    // grade is untouched. `changed` is true ONLY because the shape moved.
    const widened = {
      ...totals,
      ww_totals: [10, 10, 10],
    };
    const { patch, changed } = recomputeEntryRow(canonical, widened, WEIGHTS);
    expect(changed).toBe(true);
    expect(patch.ww_scores).toEqual([10, 10, null]);
    expect(patch.quarterly_grade).toBe(93);
    expect(patch.ww_ps).toBe(100);
  });

  it('reports a change when a denominator moves', () => {
    const { patch, changed } = recomputeEntryRow(
      canonical,
      { ...totals, qa_total: 60 },
      WEIGHTS
    );
    expect(changed).toBe(true);
    expect(patch.qa_ps).toBeCloseTo(36.6667, 3);
    expect(patch.quarterly_grade).not.toBe(93);
  });

  it('never emits letter_grade or is_na — those are operator overrides', () => {
    // A recompute derives values from raw scores. letter_grade is set by hand
    // for non-examinable subjects and is_na marks a term the student wasn't
    // enrolled for; neither is a formula output and neither may be clobbered.
    const { patch } = recomputeEntryRow(canonical, totals, WEIGHTS);
    expect(patch).not.toHaveProperty('letter_grade');
    expect(patch).not.toHaveProperty('is_na');
  });

  it('treats an entry with no stored derived values as dirty', () => {
    // A caller that didn't select the derived columns can't prove the row is
    // clean, so the safe answer is to write.
    const bare: RecomputableEntry = {
      id: 'e-2',
      ww_scores: [10, 10],
      pt_scores: [6, 10, 10],
      qa_score: 22,
    };
    expect(recomputeEntryRow(bare, totals, WEIGHTS).changed).toBe(true);
  });

  it('tolerates the numeric(7,4) rounding the database stores', () => {
    // pt_ps is stored rounded to 4dp; comparing exactly would mark every row
    // dirty on every run.
    const rounded = { ...canonical, pt_ps: 86.6667 };
    expect(recomputeEntryRow(rounded, totals, WEIGHTS).changed).toBe(false);
  });

  it('an entry with no scores at all stays null rather than becoming zero', () => {
    const empty: RecomputableEntry = {
      id: 'e-3',
      ww_scores: [],
      pt_scores: [],
      qa_score: null,
      ww_ps: null,
      pt_ps: null,
      qa_ps: null,
      initial_grade: null,
      quarterly_grade: null,
    };
    const { patch } = recomputeEntryRow(empty, totals, WEIGHTS);
    expect(patch.quarterly_grade).toBeNull();
    expect(patch.initial_grade).toBeNull();
  });
});
