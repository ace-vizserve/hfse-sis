import { describe, expect, it } from 'vitest';

import {
  applyServerEntry,
  revertPatchedFields,
  type EntryFields,
} from '@/components/grading/score-revert';

// M2.d — a rejected/cancelled score commit must fold the optimistic cell back
// to the last server-confirmed values (and ONLY the fields the failed commit
// touched), so the grid never keeps displaying a value that was never saved.

const saved: EntryFields = {
  ww_scores: [10, 8, null],
  pt_scores: [5, 5],
  qa_score: 20,
  ww_ps: 90,
  pt_ps: 100,
  qa_ps: 66.67,
  initial_grade: 88.5,
  quarterly_grade: 91,
  letter_grade: null,
  is_na: false,
};

describe('revertPatchedFields', () => {
  it('restores only the field the failed commit touched (ww_scores), whole-array', () => {
    // Optimistic state after typing 99 into WW3 (blur commit then 400s).
    const optimistic: EntryFields = { ...saved, ww_scores: [10, 8, 99] };
    const reverted = revertPatchedFields(optimistic, saved, {
      ww_scores: [10, 8, 99],
    });
    expect(reverted.ww_scores).toEqual([10, 8, null]);
    // Untouched fields keep the row's current values.
    expect(reverted.pt_scores).toEqual([5, 5]);
    expect(reverted.qa_score).toBe(20);
    expect(reverted.is_na).toBe(false);
  });

  it('restores qa_score without disturbing an unrelated in-progress edit', () => {
    // The teacher typed WW2=9 (not yet committed) AND committed a bad QA.
    const optimistic: EntryFields = {
      ...saved,
      ww_scores: [10, 9, null],
      qa_score: 999,
    };
    const reverted = revertPatchedFields(optimistic, saved, { qa_score: 999 });
    expect(reverted.qa_score).toBe(20);
    // The in-progress WW draft (not part of the failed commit) is left alone.
    expect(reverted.ww_scores).toEqual([10, 9, null]);
  });

  it('restores the is_na + letter_grade pair for the override commit shape', () => {
    const optimistic: EntryFields = { ...saved, is_na: true };
    const reverted = revertPatchedFields(optimistic, saved, {
      is_na: true,
      letter_grade: null,
    });
    expect(reverted.is_na).toBe(false);
    expect(reverted.letter_grade).toBeNull();
  });

  it('is a no-op when the body touches nothing', () => {
    const optimistic: EntryFields = { ...saved, ww_scores: [1, 2, 3] };
    const reverted = revertPatchedFields(optimistic, saved, {});
    expect(reverted).toEqual(optimistic);
  });
});

describe('applyServerEntry', () => {
  it('folds the server entry onto the row, matching the grid’s reconcile semantics', () => {
    const row: EntryFields = { ...saved };
    const next = applyServerEntry(row, {
      ww_scores: [10, 8, 7],
      pt_scores: null, // null array → keep the row's
      qa_score: 22,
      ww_ps: 92,
      pt_ps: 100,
      qa_ps: 73.33,
      initial_grade: 90.1,
      quarterly_grade: 93,
      letter_grade: null,
      is_na: null, // null → keep the row's
    });
    expect(next.ww_scores).toEqual([10, 8, 7]);
    expect(next.pt_scores).toEqual([5, 5]); // fallback
    expect(next.qa_score).toBe(22);
    expect(next.quarterly_grade).toBe(93);
    expect(next.is_na).toBe(false); // fallback
    expect(next.letter_grade).toBeNull();
  });

  it('a failed commit AFTER a successful save reverts to that save, not page-load state', () => {
    // Save 1 succeeds: WW3=7 confirmed → snapshot advances.
    const snapshot = applyServerEntry(saved, {
      ww_scores: [10, 8, 7],
      pt_scores: [5, 5],
      qa_score: 20,
      ww_ps: 92,
      pt_ps: 100,
      qa_ps: 66.67,
      initial_grade: 89,
      quarterly_grade: 92,
      letter_grade: null,
      is_na: false,
    });
    // Save 2 fails: WW3=99 rejected → revert lands on 7, not the original null.
    const optimistic: EntryFields = { ...snapshot, ww_scores: [10, 8, 99] };
    const reverted = revertPatchedFields(optimistic, snapshot, {
      ww_scores: [10, 8, 99],
    });
    expect(reverted.ww_scores).toEqual([10, 8, 7]);
    expect(reverted.quarterly_grade).toBe(92);
  });
});
