// Pure enrolment-position resolver. Given the AY's term windows and a date,
// determines whether enrolling on that date makes a late enrollee and which
// term they join. "Late" iff a term was in session on the date (activeTerm).
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
  isLateEnrollee: boolean; // activeTerm != null
  canDeferToNext: boolean; // activeTerm != null && nextTerm != null
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
  return {
    activeTerm,
    nextTerm,
    joiningTerm,
    isLateEnrollee: activeTerm !== null,
    canDeferToNext: activeTerm !== null && nextTerm !== null,
    daysLeftInActiveTerm: activeTerm
      ? daysBetween(today, activeTerm.endDate)
      : null,
  };
}
