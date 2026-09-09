// The section attendance summary card's arithmetic, as a pure function.
//
// ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
//
// The card had a stat labelled "School days" that never touched the school
// calendar. It read `attendance_records.school_days`, which
// `recompute_attendance_rollup` (migration 068) defines as "days this student
// has a mark that is not NC" — a COVERAGE count — and then took the maximum
// across the roster.
//
// On a class with complete marking the two numbers are nearly equal, so it
// looked right for a year. On P1 Respect in T3 AY2026 the term had 30 school
// days, the class had been marked on 8 of them, the best-covered student had 6
// marks, and the card said "School days 6".
//
// Two further things did not add up, both reported by Mr Ace, 2026-09-09:
// "it doesnt really give context ... we are not using the correct math".
//
//   1. `days_present` counts P + L + EX. The card printed it beside `days_late`
//      and `days_excused`, so Present(10) · Late(0) · Excused(7) · Absent(0)
//      claimed 17 marks over 6 school days. The numbers OVERLAPPED. The
//      attendance module's own compute layer had already solved this
//      (`splitOf` in attendance-overview-compute.ts, onTime = present − late −
//      excused); this card never got it.
//
//      ⚠ AND `days_present` IS THE FIELD, NOT A NAME FOR "ON TIME". Anything
//      reading it beside late and excused has the same bug; the adviser
//      dashboard's four-number cell did, and was fixed in the same pass.
//
//   2. The percentage was the mean of per-student percentages, each measured
//      only over the days that student happened to be marked. It cannot fall
//      below 100% for a class nobody has marked, because an unmarked day is
//      absent from both halves of the fraction. Respect read "100.0% average"
//      on 10 marked student-days with 7 outstanding — and a class nobody had
//      touched all term would have read 100% too.
//
// ── THE SHAPE OF THE FIX ───────────────────────────────────────────────────
//
// Three separate quantities, never again collapsed into one:
//
//   schoolDays          the CALENDAR's answer — encodable days in the term for
//                       this section's level (KD #50/#76 audience precedence).
//                       Does not depend on anyone having marked anything.
//   expectedStudentDays what SHOULD be marked by today — per student, school
//                       days between their enrolment and today (or their
//                       withdrawal). Prorated, so a child who joined in week 6
//                       is not counted absent for weeks 1-5.
//   markedStudentDays   what HAS been marked. Σ of the rollups' school_days.
//
// The rate stays over `markedStudentDays`, deliberately: an unmarked day is not
// an absence, and a card that reported one as an absence would be a different
// lie in the opposite direction. What makes the rate honest is that the gap now
// sits beside it — `expectedStudentDays - markedStudentDays` is on the card, in
// words, and cannot be read past.

export type SummaryRollupInput = {
  sectionStudentId: string;
  /** Marks that are not NC. This is COVERAGE, not the calendar. */
  schoolDays: number;
  /** P + L + EX — a superset of late and excused, not a sibling of them. */
  daysPresent: number;
  daysLate: number;
  daysExcused: number;
  daysAbsent: number;
};

export type SummaryEnrolmentInput = {
  sectionStudentId: string;
  /** null for an ordinary student enrolled from the start of the year. */
  enrollmentDate: string | null;
  withdrawalDate: string | null;
  enrollmentStatus: 'active' | 'late_enrollee' | 'withdrawn' | string;
};

export type SectionAttendanceSummary = {
  sectionId: string;
  termId: string;
  studentCount: number;

  /** School days in the term, from the calendar. Never derived from marks. */
  schoolDays: number;
  /** Of those, the ones that have already happened. */
  schoolDaysElapsed: number;
  /** Distinct dates in the term with at least one mark for this class. */
  daysMarked: number;

  /** Σ per-student school days owed by today, prorated for late joiners. */
  expectedStudentDays: number;
  /** Σ per-student marks recorded. */
  markedStudentDays: number;
  /** expected − marked, floored at zero. The number the old card hid. */
  unmarkedStudentDays: number;

  /**
   * The four states, and they SUM to `markedStudentDays`. `onTime` is present
   * with late and excused taken out, so no student-day is counted twice.
   */
  onTime: number;
  late: number;
  excused: number;
  absent: number;

  /** present (P+L+EX) ÷ markedStudentDays × 100. null when nothing is marked. */
  presentRate: number | null;
  /**
   * The mean of per-student percentages, as the card showed before.
   *
   * ⚠ KEPT ONLY so nothing silently changes meaning under the surfaces that
   * still read it. It weights a child with 4 marks the same as one with 46,
   * which is why `presentRate` exists. Prefer `presentRate` for anything new.
   */
  averageAttendancePct: number | null;

  perfectAttendanceCount: number;

  /** Total days present (P + L + EX). A superset of `late` and `excused`. */
  totalDaysPresent: number;
  totalDaysLate: number;
  totalDaysExcused: number;
  totalDaysAbsent: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * School days owed by one student, by `asOf`.
 *
 * Counts encodable dates from the later of (term start, enrolment) to the
 * earlier of (today, withdrawal). Both ends matter and both were live bugs
 * waiting to happen:
 *
 *  • Without the enrolment floor, P1 Respect's two children — who joined on
 *    24 Jul and 14 Aug of a term that began 29 Jun — would each be owed all 30
 *    days, and the card would report a fortnight of "unmarked" days from before
 *    they were students here.
 *  • Without the withdrawal ceiling, a child who left in week 3 keeps accruing
 *    owed days for the rest of the term and the class can never reach complete.
 *
 * ⚠ `enrollment_date` is NOT reliably the date a child started. Migration 068
 * uses it the same way and says so, but the historical-AY backfill stamps it
 * with the import date, which is why an AY2025 class can come back with zero
 * owed days until the column is repaired. A wrong date here understates what is
 * owed; it never invents an absence.
 */
export function expectedDaysForStudent(
  encodableDates: readonly string[],
  enrolment: SummaryEnrolmentInput,
  asOf: string
): number {
  const from = enrolment.enrollmentDate;
  const to = enrolment.withdrawalDate;
  let count = 0;
  for (const d of encodableDates) {
    if (d > asOf) break; // dates arrive sorted; nothing later can qualify
    if (from && d < from) continue;
    if (to && d > to) continue;
    count += 1;
  }
  return count;
}

export function computeSectionAttendanceSummary(input: {
  sectionId: string;
  termId: string;
  /** Encodable dates for the term, ascending, audience already resolved. */
  encodableDates: readonly string[];
  /** Distinct dates carrying at least one mark for this class. */
  markedDates: readonly string[];
  rollups: readonly SummaryRollupInput[];
  enrolments: readonly SummaryEnrolmentInput[];
  /** Singapore today, `yyyy-MM-dd`. */
  asOf: string;
}): SectionAttendanceSummary {
  const {
    sectionId,
    termId,
    encodableDates,
    markedDates,
    rollups,
    enrolments,
    asOf,
  } = input;

  const schoolDays = encodableDates.length;
  const schoolDaysElapsed = encodableDates.filter((d) => d <= asOf).length;

  // Only dates the calendar actually recognises. A mark left on a date that has
  // since become a holiday would otherwise push coverage past 100%.
  const encodableSet = new Set(encodableDates);
  const daysMarked = new Set(markedDates.filter((d) => encodableSet.has(d)))
    .size;

  // The roster drives the denominator, and it is keyed by enrolment id so a
  // student with no rollup row yet still counts as days owed. Counting from the
  // rollups instead would make an entirely unmarked class look like it had no
  // students, i.e. complete.
  let expectedStudentDays = 0;
  for (const e of enrolments) {
    expectedStudentDays += expectedDaysForStudent(encodableDates, e, asOf);
  }

  let markedStudentDays = 0;
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  let perfect = 0;
  let sumPct = 0;
  let pctCount = 0;

  for (const r of rollups) {
    markedStudentDays += r.schoolDays;
    present += r.daysPresent;
    late += r.daysLate;
    excused += r.daysExcused;
    absent += r.daysAbsent;
    if (r.daysAbsent === 0 && r.daysLate === 0 && r.schoolDays > 0)
      perfect += 1;
    if (r.schoolDays > 0) {
      sumPct += (r.daysPresent / r.schoolDays) * 100;
      pctCount += 1;
    }
  }

  return {
    sectionId,
    termId,
    studentCount: enrolments.length,
    schoolDays,
    schoolDaysElapsed,
    daysMarked,
    expectedStudentDays,
    markedStudentDays,
    unmarkedStudentDays: Math.max(0, expectedStudentDays - markedStudentDays),
    // Floored at zero for the same reason `splitOf` floors it: a hand-backfilled
    // rollup can break the "late and excused are subsets of present" invariant,
    // and a negative slice would render as a wedge pointing the wrong way.
    onTime: Math.max(0, present - late - excused),
    late,
    excused,
    absent,
    presentRate:
      markedStudentDays > 0
        ? round2((present / markedStudentDays) * 100)
        : null,
    averageAttendancePct: pctCount > 0 ? round2(sumPct / pctCount) : null,
    perfectAttendanceCount: perfect,
    totalDaysPresent: present,
    totalDaysLate: late,
    totalDaysExcused: excused,
    totalDaysAbsent: absent,
  };
}
