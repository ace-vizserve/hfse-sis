// Per-term enrolment derivation for the report card. A student's coverage is the
// union of their section_students [enrollment_date, withdrawal_date] intervals in
// the AY (a transfer = two abutting rows → continuous; active row = open end; null
// enrollment_date = open start). Drives N.A. for terms the student wasn't enrolled
// in, and the clamped attendance denominator for the term they joined/left mid-way.
//
// All dates are date-only SGT 'yyyy-mm-dd' strings (KD #32): lexicographic compare,
// no Date/timezone math.

export type EnrolmentInterval = { start: string | null; end: string | null };

// True when any interval overlaps the term window [termStart, termEnd].
// null start = -infinity, null end = +infinity.
export function isEnrolledForTerm(
  coverage: EnrolmentInterval[],
  termStart: string,
  termEnd: string
): boolean {
  return coverage.some((iv) => {
    const endsAtOrAfterTermStart = iv.end == null || iv.end >= termStart;
    const startsAtOrBeforeTermEnd = iv.start == null || iv.start <= termEnd;
    return endsAtOrAfterTermStart && startsAtOrBeforeTermEnd;
  });
}

// True when the date falls inside any interval (inclusive both ends).
export function dateInCoverage(
  date: string,
  coverage: EnrolmentInterval[]
): boolean {
  return coverage.some(
    (iv) =>
      (iv.start == null || iv.start <= date) &&
      (iv.end == null || date <= iv.end)
  );
}

// enrolled = the coverage overlaps the term window (date-based, so an unconfigured
// calendar does NOT falsely mark an enrolled term N.A.). enrolledSchoolDays = the
// calendar teaching days that fall inside coverage (the clamped denominator); 0
// when not enrolled or when the calendar is empty (caller falls back).
export function termEnrolment(
  coverage: EnrolmentInterval[],
  term: { start_date: string; end_date: string },
  calendarDates: string[]
): { enrolled: boolean; enrolledSchoolDays: number } {
  const enrolled = isEnrolledForTerm(coverage, term.start_date, term.end_date);
  const enrolledSchoolDays = enrolled
    ? calendarDates.filter((d) => dateInCoverage(d, coverage)).length
    : 0;
  return { enrolled, enrolledSchoolDays };
}
