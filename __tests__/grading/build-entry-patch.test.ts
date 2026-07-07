import { describe, it, expect } from 'vitest';
import { buildEntryPatch } from '@/app/api/grading-sheets/[id]/entries/[entryId]/route';

// H2 — a locked-sheet change-request "apply" must patch ONLY the single
// approved slot, built from the entry's CURRENT DB array. It must never
// write the client's full (possibly stale) array, which would silently
// clobber every other slot under an approval_reference that never covered
// them (Hard Rule #5).
describe('buildEntryPatch (change-request apply patch)', () => {
  it('ww_scores: replaces only the approved slot, preserving every other DB value', () => {
    const currentArrays = {
      ww_scores: [10, 8, null, 5, 9],
      pt_scores: null,
    };
    const patch = buildEntryPatch('ww_scores', 7, currentArrays, 2);
    expect(patch.ww_scores).toEqual([10, 8, 7, 5, 9]);
    // Untouched slots are byte-identical to the DB array, not derived from
    // any client-supplied array.
    expect(patch.pt_scores).toBeUndefined();
  });

  it('pt_scores: replaces only the approved slot, preserving every other DB value', () => {
    const currentArrays = {
      ww_scores: null,
      pt_scores: [4, 4, 4],
    };
    const patch = buildEntryPatch('pt_scores', 9, currentArrays, 0);
    expect(patch.pt_scores).toEqual([9, 4, 4]);
    expect(patch.ww_scores).toBeUndefined();
  });

  it('is immune to a stale/wrong client array — only slotIndex + proposedValue matter', () => {
    // Simulates: browser holds a stale ww_scores array (from before another
    // registrar applied a different correction). Even though the "current"
    // array we pass in is the ONLY input besides proposedValue/slotIndex,
    // confirm no other array is consulted anywhere — buildEntryPatch's
    // signature no longer accepts the raw client body at all.
    const dbArray = [1, 2, 3];
    const patch = buildEntryPatch(
      'ww_scores',
      99,
      { ww_scores: dbArray, pt_scores: null },
      1
    );
    expect(patch.ww_scores).toEqual([1, 99, 3]);
  });

  it('extends a short DB array with nulls when slotIndex is past its current length', () => {
    const patch = buildEntryPatch(
      'ww_scores',
      6,
      { ww_scores: [10], pt_scores: null },
      3
    );
    expect(patch.ww_scores).toEqual([10, null, null, 6]);
  });

  it('treats a null DB array as empty before inserting the approved slot', () => {
    const patch = buildEntryPatch(
      'pt_scores',
      8,
      { ww_scores: null, pt_scores: null },
      0
    );
    expect(patch.pt_scores).toEqual([8]);
  });

  it('a null proposed value clears just that slot, others untouched', () => {
    const patch = buildEntryPatch(
      'ww_scores',
      null,
      { ww_scores: [10, 8, 5], pt_scores: null },
      1
    );
    expect(patch.ww_scores).toEqual([10, null, 5]);
  });

  it('returns an empty patch for ww_scores/pt_scores when slotIndex is null (no slot to target)', () => {
    const patch = buildEntryPatch(
      'ww_scores',
      7,
      { ww_scores: [10, 8], pt_scores: null },
      null
    );
    expect(patch).toEqual({});
  });

  it('qa_score: scalar field, written directly from the approved value', () => {
    const patch = buildEntryPatch(
      'qa_score',
      21,
      { ww_scores: null, pt_scores: null },
      null
    );
    expect(patch).toEqual({ qa_score: 21 });
  });

  it('letter_grade: scalar field, written directly from the approved value', () => {
    const patch = buildEntryPatch(
      'letter_grade',
      'UG',
      { ww_scores: null, pt_scores: null },
      null
    );
    expect(patch).toEqual({ letter_grade: 'UG' });
  });

  it('letter_grade: null clears the override', () => {
    const patch = buildEntryPatch(
      'letter_grade',
      null,
      { ww_scores: null, pt_scores: null },
      null
    );
    expect(patch).toEqual({ letter_grade: null });
  });

  it('is_na: scalar boolean field, written directly from the approved value', () => {
    const patch = buildEntryPatch(
      'is_na',
      true,
      { ww_scores: null, pt_scores: null },
      null
    );
    expect(patch).toEqual({ is_na: true });
  });
});
