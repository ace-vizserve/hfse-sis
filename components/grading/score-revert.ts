// Optimistic-revert helpers for the score-entry grid (KD #24 Tier-3: the grid
// keeps local-state optimism — cells update via local state as the teacher
// types, then a blur commits a PATCH). When that commit FAILS (server 4xx /
// network error) or is CANCELLED (locked-sheet approval dialog dismissed), the
// optimistic cell + its derived Total must fold back to the last
// server-confirmed values instead of displaying a number that was never saved.
//
// Pure + unit-tested (__tests__/grading/score-revert.test.ts). The grid keeps
// a "last saved" snapshot per entry (seeded from the RSC rows, advanced only
// on a successful PATCH reconcile) and calls revertPatchedFields with the
// failed commit's body so ONLY the touched fields are restored — an unrelated
// in-progress edit on another field of the same row is left alone.

export type EntryFields = {
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  letter_grade: string | null;
  is_na: boolean;
};

/** The writable fields a per-cell commit can carry. */
export type EntryPatchBody = Partial<
  Pick<
    EntryFields,
    'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na'
  >
>;

/**
 * Restore ONLY the fields a failed/cancelled commit touched (the keys present
 * on `body`) from the last server-confirmed snapshot. Score arrays are
 * restored whole — the failed payload carried the whole array, so partial
 * restoration would keep unsaved values.
 */
export function revertPatchedFields<T extends EntryFields>(
  row: T,
  saved: EntryFields,
  body: EntryPatchBody
): T {
  const out = { ...row };
  if ('ww_scores' in body) out.ww_scores = saved.ww_scores;
  if ('pt_scores' in body) out.pt_scores = saved.pt_scores;
  if ('qa_score' in body) out.qa_score = saved.qa_score;
  if ('letter_grade' in body) out.letter_grade = saved.letter_grade;
  if ('is_na' in body) out.is_na = saved.is_na;
  return out;
}

/** The entry shape the entries PATCH route returns on success. */
export type ServerEntry = {
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  letter_grade: string | null;
  is_na: boolean | null;
};

/**
 * Fold a successful PATCH response onto a row. Shared by the rows-state
 * reconcile AND the last-saved snapshot update so the two can never drift.
 * Field semantics are byte-identical to the grid's original inline reconcile:
 * null score arrays / is_na fall back to the row's value; everything else is
 * taken from the server.
 */
export function applyServerEntry<T extends EntryFields>(
  row: T,
  entry: ServerEntry
): T {
  return {
    ...row,
    ww_scores: entry.ww_scores ?? row.ww_scores,
    pt_scores: entry.pt_scores ?? row.pt_scores,
    qa_score: entry.qa_score,
    ww_ps: entry.ww_ps,
    pt_ps: entry.pt_ps,
    qa_ps: entry.qa_ps,
    initial_grade: entry.initial_grade,
    quarterly_grade: entry.quarterly_grade,
    letter_grade: entry.letter_grade ?? null,
    is_na: entry.is_na ?? row.is_na,
  };
}
