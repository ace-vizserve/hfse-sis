// Shared term-overlap resolver — single source of truth so the Markbook
// "Grades entered" KPI card and its entry-kind drill scope by the SAME set of
// terms. Both used to read every term in the AY regardless of the date-range
// picker, so picking "Term 2" or "This term" still counted/listed grades from
// all four terms and the two surfaces could disagree.
//
// Rule: a term is in scope when its [start_date, end_date] window OVERLAPS the
// picker's [from, to] window (inclusive on both ends). When no range is given
// (both from/to absent), fall back to ALL terms — that's "Current AY" /
// AY-wide semantics, matching the rest of the dashboard.
//
// Pure, no I/O — unit-tested in __tests__/markbook/term-range.test.ts.

export type TermWindow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
};

export function termIdsForRange(
  terms: TermWindow[],
  from?: string | null,
  to?: string | null
): string[] {
  // No range → AY-wide fallback (all terms).
  if (!from || !to) {
    return terms.map((t) => t.id);
  }

  // A term with no dates can't be intersected against a range — exclude it
  // defensively (it would otherwise leak grades into every scoped view).
  return terms
    .filter((t) => {
      if (!t.start_date || !t.end_date) return false;
      // Inclusive overlap: [start, end] ∩ [from, to] ≠ ∅.
      return t.start_date <= to && t.end_date >= from;
    })
    .map((t) => t.id);
}
