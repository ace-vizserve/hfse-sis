import { describe, expect, it } from 'vitest';
import { isRowComplete } from '@/lib/grading/row-complete';

const SHEET = { ww_totals: [15, 15], pt_totals: [20, 20, 20], qa_total: 60 };
const BLANK = {
  ww_scores: [null, null],
  pt_scores: [null, null, null],
  qa_score: null,
  is_na: false,
  letter_grade: null,
};

describe('isRowComplete', () => {
  it('is not complete on the first day of encoding', () => {
    expect(isRowComplete({ ...BLANK, ww_scores: [14, null] }, SHEET)).toBe(
      false
    );
  });

  it('is complete once every slot and the exam hold a score (0 counts)', () => {
    expect(
      isRowComplete(
        { ...BLANK, ww_scores: [14, 0], pt_scores: [18, 20, 19], qa_score: 50 },
        SHEET
      )
    ).toBe(true);
  });

  it('does not wait for an excused slot', () => {
    expect(
      isRowComplete(
        {
          ...BLANK,
          ww_scores: [null, 12],
          pt_scores: [18, 20, 19],
          qa_score: 50,
          ww_excused: [1],
        },
        SHEET
      )
    ).toBe(true);
  });

  it('needs the exam only when the sheet has one', () => {
    const row = { ...BLANK, ww_scores: [14, 12], pt_scores: [18, 20, 19] };
    expect(isRowComplete(row, SHEET)).toBe(false);
    expect(isRowComplete(row, { ...SHEET, qa_total: null })).toBe(true);
  });

  it('treats N/A and a UG/E override as finished', () => {
    expect(isRowComplete({ ...BLANK, is_na: true }, SHEET)).toBe(true);
    expect(isRowComplete({ ...BLANK, letter_grade: 'UG' }, SHEET)).toBe(true);
  });

  it('a sheet with no slots configured is never complete', () => {
    expect(
      isRowComplete(BLANK, { ww_totals: [], pt_totals: [], qa_total: null })
    ).toBe(false);
  });
});
