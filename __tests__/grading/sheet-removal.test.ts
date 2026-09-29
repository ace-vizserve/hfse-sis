import { describe, expect, it } from 'vitest';

import {
  decideSheetRemoval,
  entryHasEnteredData,
  sheetHasEnteredData,
  SHEET_REMOVAL_REASONS,
  type GradeEntryValues,
} from '@/lib/grading/sheet-removal';

// A seeded row nobody has touched: every value blank.
const blank = (over: Partial<GradeEntryValues> = {}): GradeEntryValues => ({
  ww_scores: [null, null],
  pt_scores: [null, null, null],
  qa_score: null,
  ww_ps: null,
  pt_ps: null,
  qa_ps: null,
  initial_grade: null,
  quarterly_grade: null,
  letter_grade: null,
  is_na: false,
  ww_excused: [],
  pt_excused: [],
  ...over,
});

describe('sheetHasEnteredData', () => {
  it('all-null rows → nothing entered (removable)', () => {
    expect(sheetHasEnteredData([blank(), blank(), blank()])).toBe(false);
  });

  it('no rows at all → nothing entered', () => {
    expect(sheetHasEnteredData([])).toBe(false);
  });

  it('empty arrays and missing columns → nothing entered', () => {
    expect(sheetHasEnteredData([{ ww_scores: [], pt_scores: [] }, {}])).toBe(
      false
    );
  });

  it('a single WW score of 0 → entered (blank ≠ zero, Hard Rule #3)', () => {
    expect(
      sheetHasEnteredData([blank(), blank({ ww_scores: [0, null] })])
    ).toBe(true);
  });

  it('a PT score → entered', () => {
    expect(sheetHasEnteredData([blank({ pt_scores: [null, 7, null] })])).toBe(
      true
    );
  });

  it('an exam score of 0 → entered', () => {
    expect(sheetHasEnteredData([blank({ qa_score: 0 })])).toBe(true);
  });

  it('a letter override → entered', () => {
    expect(sheetHasEnteredData([blank({ letter_grade: 'A' })])).toBe(true);
  });

  it('a whitespace-only letter is not a letter', () => {
    expect(entryHasEnteredData(blank({ letter_grade: '  ' }))).toBe(false);
  });

  it('is_na → entered', () => {
    expect(sheetHasEnteredData([blank({ is_na: true })])).toBe(true);
  });

  it('an excused slot → entered', () => {
    expect(sheetHasEnteredData([blank({ ww_excused: [1] })])).toBe(true);
    expect(sheetHasEnteredData([blank({ pt_excused: [2] })])).toBe(true);
  });

  it('a derived figure alone → entered', () => {
    expect(sheetHasEnteredData([blank({ quarterly_grade: 75 })])).toBe(true);
    expect(sheetHasEnteredData([blank({ initial_grade: 0 })])).toBe(true);
    expect(sheetHasEnteredData([blank({ ww_ps: 0 })])).toBe(true);
  });
});

describe('decideSheetRemoval', () => {
  it('open, empty, no history → removable', () => {
    expect(
      decideSheetRemoval({
        isLocked: false,
        hasEnteredData: false,
        hasHistory: false,
      })
    ).toEqual({ removable: true, reason: null });
  });

  it('entered → refused with the plain-English reason', () => {
    const v = decideSheetRemoval({
      isLocked: false,
      hasEnteredData: true,
      hasHistory: false,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(
      'This sheet has scores entered, so it can’t be removed.'
    );
  });

  it('locked wins over everything', () => {
    const v = decideSheetRemoval({
      isLocked: true,
      hasEnteredData: false,
      hasHistory: false,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(SHEET_REMOVAL_REASONS.locked);
  });

  it('blank now but with history → refused', () => {
    const v = decideSheetRemoval({
      isLocked: false,
      hasEnteredData: false,
      hasHistory: true,
    });
    expect(v.removable).toBe(false);
    expect(v.reason).toBe(SHEET_REMOVAL_REASONS.history);
  });
});
