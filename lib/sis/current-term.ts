// Shared "current / default term" resolver.
//
// "Which term is now" is a date fact, but `terms.is_current` is a manually-set
// flag that often isn't maintained — so flag-only pickers silently fall back to
// the first term (T1). This resolves it consistently from the date, with the
// flag and sensible fallbacks layered underneath. Pure (no I/O) so it can be
// unit-tested and called from any server component that already loaded its terms.
//
// Resolution order for a given `today` (yyyy-MM-dd):
//   1. the term whose [start_date, end_date] window contains today
//   2. the `is_current` flag (manual override — only matters in between-terms gaps)
//   3. the most-recently-ended term (today is past its end_date)
//   4. the earliest term (today precedes the year, or no dates are set)

export type TermLike = {
  id: string;
  term_number: number;
  start_date: string | null;
  end_date: string | null;
  is_current?: boolean | null;
};

/** Resolve the current/default term object for `today`, or null if `terms` is empty. */
export function resolveCurrentTerm<T extends TermLike>(
  terms: T[],
  today: string
): T | null {
  if (terms.length === 0) return null;

  // 1. Term containing today.
  const containing = terms.find(
    (t) =>
      t.start_date && t.end_date && t.start_date <= today && today <= t.end_date
  );
  if (containing) return containing;

  // 2. Manual is_current flag (override for the between-terms gap).
  const flagged = terms.find((t) => t.is_current === true);
  if (flagged) return flagged;

  // 3. Most-recently-ended term (largest end_date that's before today).
  const ended = terms
    .filter(
      (t): t is T & { end_date: string } => !!t.end_date && t.end_date < today
    )
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  if (ended) return ended;

  // 4. Earliest term by term_number.
  return [...terms].sort((a, b) => a.term_number - b.term_number)[0];
}

/** Convenience: resolve the current/default term id, or null if `terms` is empty. */
export function resolveCurrentTermId(
  terms: TermLike[],
  today: string
): string | null {
  return resolveCurrentTerm(terms, today)?.id ?? null;
}

/**
 * Has the academic year begun? True when the EARLIEST non-null term start_date
 * is on or before `today`.
 *
 * This is the "term-started" gate from KD #136 (the escalated Generate-index
 * warning), lifted out of three byte-identical inline copies — /sis/sections,
 * /sis/sections/[id] and /markbook/sections — so there is one tested definition
 * rather than three that can drift apart.
 *
 * Deliberately spans the WHOLE year, not just the term in progress: the gaps
 * between terms are when staffing gets reshuffled, and by then marks already
 * exist. Use `resolveCurrentTerm` instead when you need which term it is now.
 *
 * A term with no start_date counts as NOT started, so an unconfigured calendar
 * never blocks setup work. Pass `sgToday()` as `today` (SGT date — KD #32).
 */
export function hasTermStarted(
  terms: Array<{ start_date: string | null }>,
  today: string
): boolean {
  return terms.some((t) => !!t.start_date && t.start_date <= today);
}
