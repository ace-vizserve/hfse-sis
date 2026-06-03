// Pure enrolment-position resolver. Given the AY's term windows and a date,
// determines whether enrolling on that date makes a late enrollee and which
// term they join. "Late" iff the school year (T1) has STARTED and there is a
// term to join — so a student joining after T1's start is late whether a term
// is in session (mid-term) OR they land in a between-terms break. Only enrolling
// BEFORE T1 begins is on-time. The current-vs-next term choice is only offered
// mid-term (canDeferToNext); in a break the only option is the next term, but
// it is still a late join.
// See docs/superpowers/specs/2026-06-01-late-enrollee-detection-design.md.

export type TermWindow = {
  termNumber: number;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
};

export type EnrolmentPosition = {
  activeTerm: TermWindow | null; // term containing `today`
  nextTerm: TermWindow | null; // earliest term starting after `today`
  joiningTerm: TermWindow | null; // activeTerm ?? nextTerm
  yearStarted: boolean; // the earliest term (T1) has begun: min(startDate) <= today
  isLateEnrollee: boolean; // yearStarted && a joining term exists
  canDeferToNext: boolean; // activeTerm != null && nextTerm != null (current-vs-next choice)
  daysLeftInActiveTerm: number | null; // whole days from today to activeTerm.endDate
};

function daysBetween(fromIso: string, toIso: string): number {
  const u = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  return Math.round((u(toIso) - u(fromIso)) / 86_400_000);
}

export function resolveEnrolmentPosition(
  terms: TermWindow[],
  today: string
): EnrolmentPosition {
  const activeTerm =
    terms.find((t) => t.startDate <= today && today <= t.endDate) ?? null;
  const nextTerm =
    [...terms]
      .filter((t) => t.startDate > today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const joiningTerm = activeTerm ?? nextTerm;
  const earliestStart =
    terms.length > 0
      ? terms.reduce(
          (min, t) => (t.startDate < min ? t.startDate : min),
          terms[0].startDate
        )
      : null;
  const yearStarted = earliestStart !== null && earliestStart <= today;
  return {
    activeTerm,
    nextTerm,
    joiningTerm,
    yearStarted,
    isLateEnrollee: yearStarted && joiningTerm !== null,
    canDeferToNext: activeTerm !== null && nextTerm !== null,
    daysLeftInActiveTerm: activeTerm
      ? daysBetween(today, activeTerm.endDate)
      : null,
  };
}
