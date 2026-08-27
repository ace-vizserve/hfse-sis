// Vacation leave is counted in TRIPS, not days.
//
// ⚠ THIS CORRECTS SHIPPED BEHAVIOUR. KD #94 counted `attendance_daily` rows
// tagged `vacation` in the term, so a five-day family holiday read as **5 used
// against an allowance of 1** — and every surface that reports the quota (the
// student card, Insights, the drill, the adviser dashboard, the warning in the
// marking grid) reported it that way. Mr Ace, 2026-08-27, asked directly:
// _"who does vacation 1 day bruh its one trip"_. The school's own workbook
// header says "4 Vacation Leaves: 1 per term", which reads both ways; this is
// the school settling it.
//
// **A trip is already visible in the register and needs no new data.** It is a
// run of vacation-marked SCHOOL days with no ordinary school day interrupting
// it. Friday-to-Tuesday is Fri, Mon, Tue — one trip, because the weekend is
// not a school day. Two vacation days with an Absent between them are two
// trips, because the child came back to school in between.
//
// ⚠ SCHOOL DAYS, NOT CALENDAR DAYS, and that is the whole reason this takes a
// day list rather than doing date arithmetic. Bridging a weekend by "dates
// within 3 of each other" would also bridge a Monday the child spent in class.
//
// Counting runs rather than declarations is deliberate: it keeps working for a
// family who phoned the office instead of filing, and it leaves ONE source of
// truth — the register — so the six screens reading the quota cannot drift
// from each other or from what a teacher sees on the sheet.

/**
 * How many separate trips the vacation-marked days represent.
 *
 * @param termSchoolDays every school day in the term, ASCENDING. Non-school
 *   days must be absent from this list — they are what a trip is allowed to
 *   span.
 * @param vacationDates the days marked `EX` / `vacation`, as a set.
 * @param startedBeforeTerm whether the school day immediately preceding this
 *   term was itself a vacation day.
 *
 * ⚠ `startedBeforeTerm` IS THE TERM-BOUNDARY RULE, and it is Mr Ace's call
 * (2026-08-27): a trip spanning two terms is counted **only in the term it
 * started in**, not in both. A holiday is one thing the family did, and
 * spending two of their four yearly allowances on it is harsher than the
 * policy says; a filing already carries a start date, so attributing leave to
 * where it begins is how leave is normally accounted.
 *
 * The known hole, accepted rather than overlooked: such a trip eats school
 * days in the LATER term without spending that term's allowance. Reaching it
 * requires being away across an entire inter-term break — at HFSE that is ten
 * days or more — while missing school days on both sides. The approver is
 * looking at the dates when they decide.
 */
export function countVacationTrips(
  termSchoolDays: string[],
  vacationDates: ReadonlySet<string>,
  startedBeforeTerm: boolean
): number {
  let trips = 0;
  // Seeded from the previous term. When a run carries in, the term's first
  // vacation day continues it instead of opening a new one — which is exactly
  // "count it where it started".
  let previousWasVacation = startedBeforeTerm;

  for (const day of termSchoolDays) {
    const onVacation = vacationDates.has(day);
    // A trip begins the moment a vacation day follows something that is not
    // one. Everything else is the middle of a trip, or not a trip at all.
    if (onVacation && !previousWasVacation) trips += 1;
    previousWasVacation = onVacation;
  }

  return trips;
}
