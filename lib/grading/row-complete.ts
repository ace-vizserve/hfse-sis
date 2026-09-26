// Is this student's term fully graded on this sheet?
//
// A quarterly grade exists from the very first score (a blank slot scores zero
// against the full total, migration 177), so "has a quarterly grade" says
// nothing about whether the grade is finished — a student with one quiz in
// reads 64 and looks failing. The grid only colours a grade, and the Graded
// counts only count a student, once every slot that counts has a score:
//
//   - every WW and PT slot with a max, except the ones excused for this
//     student (migration 179), holds a score (a 0 counts; a blank does not);
//   - the exam holds a score, when the sheet has an exam total;
//   - or the student is marked N/A, or carries a UG/E letter override, which
//     are finished answers in their own right.

export type CompletableRow = {
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  ww_excused?: number[] | null;
  pt_excused?: number[] | null;
  is_na: boolean;
  letter_grade: string | null;
};

export type CompletableSheet = {
  ww_totals: (number | null)[] | null;
  pt_totals: (number | null)[] | null;
  qa_total: number | null;
};

function componentComplete(
  scores: (number | null)[] | null,
  totals: (number | null)[] | null,
  excused: number[] | null | undefined
): boolean {
  return (totals ?? []).every(
    (max, i) =>
      max == null ||
      (excused ?? []).includes(i + 1) ||
      (scores ?? [])[i] != null
  );
}

/**
 * How many counted slots (and the exam) are still blank. 0 for a finished
 * row, and for N/A or a UG/E override.
 */
export function missingScoreCount(
  row: CompletableRow,
  sheet: CompletableSheet
): number {
  if (row.is_na || row.letter_grade != null) return 0;
  const blanks = (
    scores: (number | null)[] | null,
    totals: (number | null)[] | null,
    excused: number[] | null | undefined
  ) =>
    (totals ?? []).filter(
      (max, i) =>
        max != null &&
        !(excused ?? []).includes(i + 1) &&
        (scores ?? [])[i] == null
    ).length;
  return (
    blanks(row.ww_scores, sheet.ww_totals, row.ww_excused) +
    blanks(row.pt_scores, sheet.pt_totals, row.pt_excused) +
    (sheet.qa_total != null && row.qa_score == null ? 1 : 0)
  );
}

export function isRowComplete(
  row: CompletableRow,
  sheet: CompletableSheet
): boolean {
  if (row.is_na || row.letter_grade != null) return true;
  const hasAnySlot =
    (sheet.ww_totals ?? []).length > 0 ||
    (sheet.pt_totals ?? []).length > 0 ||
    sheet.qa_total != null;
  if (!hasAnySlot) return false;
  return (
    componentComplete(row.ww_scores, sheet.ww_totals, row.ww_excused) &&
    componentComplete(row.pt_scores, sheet.pt_totals, row.pt_excused) &&
    (sheet.qa_total == null || row.qa_score != null)
  );
}
