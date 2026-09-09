import { describe, it, expect } from 'vitest';

import {
  computeSectionAttendanceSummary,
  expectedDaysForStudent,
  type SummaryEnrolmentInput,
  type SummaryRollupInput,
} from '@/lib/attendance/section-summary';

// The case that started this, with production's real numbers.
//
// P1 Respect, Term 3 AY2026 (2026-06-29 → 2026-09-04), read on 2026-09-09:
//   • 30 encodable school days on the calendar
//   • 2 students, BOTH late enrollees — 24 Jul and 14 Aug
//   • marks on 8 distinct dates
//   • rollups: 6 marks (3 excused) and 4 marks (4 excused), no absences
//
// The card said: School days 6 · Present 10 · Late 0 · Excused 7 · Absent 0 ·
// 100.0% average. Three separate untruths in one row — 6 is not the number of
// school days, 10 + 0 + 7 + 0 is more marks than exist, and 100% was measured
// only over the days somebody had already marked.

// A compressed stand-in for the term's 30 encodable days — 19 real dates,
// spread across the same months, enough to exercise both enrolment floors and
// still leave more days owed than marked (which is the whole point of the
// case). Written out rather than generated: a fixture that computes its own
// expectations only restates the implementation.
const TERM_DATES = [
  '2026-06-29',
  '2026-06-30',
  //
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-23',
  '2026-07-24', // student 1 joins — 12 dates from here to `asOf`
  '2026-07-27',
  '2026-07-28',
  '2026-07-29',
  //
  '2026-08-13',
  '2026-08-14', // student 2 joins — 7 dates from here to `asOf`
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  //
  '2026-09-07',
  '2026-09-08',
  '2026-09-10', // after `asOf` — in the term, not yet owed
];

const ASOF = '2026-09-09';

const enrolment = (
  over: Partial<SummaryEnrolmentInput> & { sectionStudentId: string }
): SummaryEnrolmentInput => ({
  enrollmentDate: null,
  withdrawalDate: null,
  enrollmentStatus: 'active',
  ...over,
});

const rollup = (
  over: Partial<SummaryRollupInput> & { sectionStudentId: string }
): SummaryRollupInput => ({
  schoolDays: 0,
  daysPresent: 0,
  daysLate: 0,
  daysExcused: 0,
  daysAbsent: 0,
  ...over,
});

const respect = () =>
  computeSectionAttendanceSummary({
    sectionId: 'sec-respect',
    termId: 'term-3',
    encodableDates: TERM_DATES,
    markedDates: ['2026-07-24', '2026-07-27', '2026-08-14', '2026-08-17'],
    enrolments: [
      enrolment({
        sectionStudentId: 's1',
        enrollmentDate: '2026-07-24',
        enrollmentStatus: 'late_enrollee',
      }),
      enrolment({
        sectionStudentId: 's2',
        enrollmentDate: '2026-08-14',
        enrollmentStatus: 'late_enrollee',
      }),
    ],
    rollups: [
      rollup({
        sectionStudentId: 's1',
        schoolDays: 6,
        daysPresent: 6,
        daysExcused: 3,
      }),
      rollup({
        sectionStudentId: 's2',
        schoolDays: 4,
        daysPresent: 4,
        daysExcused: 4,
      }),
    ],
    asOf: ASOF,
  });

describe('school days come from the calendar, not from the marks', () => {
  it('reports every encodable day in the term', () => {
    // The whole bug in one assertion. The old card answered 6 — the best-covered
    // student's mark count — to the question "how many school days".
    expect(respect().schoolDays).toBe(TERM_DATES.length);
  });

  it('separates the days that have happened from the whole term', () => {
    const s = respect();
    expect(s.schoolDaysElapsed).toBe(TERM_DATES.length - 1); // 2026-09-10 is ahead
    expect(s.schoolDaysElapsed).toBeLessThan(s.schoolDays);
  });

  it('counts coverage separately from the calendar', () => {
    expect(respect().daysMarked).toBe(4);
  });

  it('ignores a mark left on a date the calendar no longer accepts', () => {
    // A date marked and then turned into a holiday. Without the filter, coverage
    // could exceed the number of school days and read as more than complete.
    const s = computeSectionAttendanceSummary({
      sectionId: 'sec',
      termId: 't',
      encodableDates: ['2026-07-01', '2026-07-02'],
      markedDates: ['2026-07-01', '2026-07-02', '2026-07-03'],
      enrolments: [enrolment({ sectionStudentId: 's1' })],
      rollups: [],
      asOf: ASOF,
    });
    expect(s.daysMarked).toBe(2);
    expect(s.daysMarked).toBeLessThanOrEqual(s.schoolDays);
  });
});

describe('the four states add up', () => {
  it('takes late and excused out of present, so nothing is double-counted', () => {
    const s = respect();
    // Present was 10 and included all 7 excused. On time is what is left.
    expect(s.totalDaysPresent).toBe(10);
    expect(s.excused).toBe(7);
    expect(s.onTime).toBe(3);
    expect(s.onTime + s.late + s.excused + s.absent).toBe(s.markedStudentDays);
  });

  it('never renders a negative slice from a broken rollup', () => {
    // A hand-backfilled row where late + excused exceeds present. Real enough to
    // guard: the AY2025 import writes these rows directly.
    const s = computeSectionAttendanceSummary({
      sectionId: 'sec',
      termId: 't',
      encodableDates: ['2026-07-01'],
      markedDates: ['2026-07-01'],
      enrolments: [enrolment({ sectionStudentId: 's1' })],
      rollups: [
        rollup({
          sectionStudentId: 's1',
          schoolDays: 1,
          daysPresent: 1,
          daysLate: 2,
          daysExcused: 2,
        }),
      ],
      asOf: ASOF,
    });
    expect(s.onTime).toBe(0);
  });
});

describe('the denominator is prorated student-days, not days × heads', () => {
  it('owes a late joiner nothing from before they arrived', () => {
    // Of the 18 elapsed dates, student 1 (joined 24 Jul) is owed 12 and
    // student 2 (joined 14 Aug) is owed 7 — not 18 each. Without the floor the
    // card would report a month of "unmarked" days from before either child
    // was a student here, and blame the adviser for them.
    expect(respect().expectedStudentDays).toBe(12 + 7);
  });

  it('stops owing days once a student withdraws', () => {
    const days = expectedDaysForStudent(
      TERM_DATES,
      enrolment({
        sectionStudentId: 's1',
        withdrawalDate: '2026-07-01',
        enrollmentStatus: 'withdrawn',
      }),
      ASOF
    );
    expect(days).toBe(3); // 29 Jun, 30 Jun, 1 Jul
  });

  it('never owes days for a date in the future', () => {
    const days = expectedDaysForStudent(
      TERM_DATES,
      enrolment({ sectionStudentId: 's1' }),
      ASOF
    );
    expect(days).toBe(TERM_DATES.length - 1);
  });

  it('counts a student with no rollup row at all toward what is owed', () => {
    // The failure this prevents: deriving the roster from the rollups instead
    // of the enrolments makes a class nobody has marked look like a class with
    // no students — which reads as complete rather than as untouched.
    const s = computeSectionAttendanceSummary({
      sectionId: 'sec',
      termId: 't',
      encodableDates: ['2026-07-01', '2026-07-02'],
      markedDates: [],
      enrolments: [
        enrolment({ sectionStudentId: 's1' }),
        enrolment({ sectionStudentId: 's2' }),
      ],
      rollups: [],
      asOf: ASOF,
    });
    expect(s.studentCount).toBe(2);
    expect(s.expectedStudentDays).toBe(4);
    expect(s.unmarkedStudentDays).toBe(4);
    expect(s.presentRate).toBeNull();
  });
});

describe('the gap the old card hid', () => {
  it('says how many student-days are still unmarked', () => {
    const s = respect();
    expect(s.markedStudentDays).toBe(10);
    expect(s.unmarkedStudentDays).toBe(s.expectedStudentDays - 10);
  });

  it('still reports 100% for these two children, and that is correct', () => {
    // The rate is deliberately NOT dragged down by unmarked days: an unmarked
    // day is not an absence, and reporting it as one would be a new lie in the
    // other direction. What changed is that the rate no longer stands alone.
    const s = respect();
    expect(s.presentRate).toBe(100);
    expect(s.unmarkedStudentDays).toBeGreaterThan(0);
  });

  it('floors the gap at zero when more is marked than was owed', () => {
    // Possible with a stale enrollment_date — see the note on
    // expectedDaysForStudent. A negative gap must not render as "-4 to mark".
    const s = computeSectionAttendanceSummary({
      sectionId: 'sec',
      termId: 't',
      encodableDates: ['2026-07-01'],
      markedDates: ['2026-07-01'],
      enrolments: [
        enrolment({ sectionStudentId: 's1', enrollmentDate: '2026-09-01' }),
      ],
      rollups: [
        rollup({ sectionStudentId: 's1', schoolDays: 5, daysPresent: 5 }),
      ],
      asOf: ASOF,
    });
    expect(s.expectedStudentDays).toBe(0);
    expect(s.unmarkedStudentDays).toBe(0);
  });
});

describe('an empty section', () => {
  it('reports the calendar even with nobody on the roster', () => {
    // The calendar does not depend on the roster. A section awaiting students
    // still has school days, and saying "0 school days" would be wrong.
    const s = computeSectionAttendanceSummary({
      sectionId: 'sec',
      termId: 't',
      encodableDates: ['2026-07-01', '2026-07-02'],
      markedDates: [],
      enrolments: [],
      rollups: [],
      asOf: ASOF,
    });
    expect(s.schoolDays).toBe(2);
    expect(s.studentCount).toBe(0);
    expect(s.presentRate).toBeNull();
    expect(s.perfectAttendanceCount).toBe(0);
  });
});
