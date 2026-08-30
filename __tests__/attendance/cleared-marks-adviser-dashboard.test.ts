/**
 * A cleared day is excluded from the form class adviser's dashboard.
 *
 * Migration 134 made `attendance_daily.status` nullable: a NULL row is how a
 * mark is UNDONE, appended like any correction and superseding the prior mark
 * by `recorded_at`. So the newest row for a day may carry no status, and such a
 * day is NOT MARKED.
 *
 * This dashboard asks one question every morning — IS TODAY MARKED — and a
 * cleared row broke both halves of the answer:
 *
 *   1. `tallyToday` counts DISTINCT STUDENTS carrying a mark into `marked`,
 *      then buckets each one into present / late / absent / excused / noClass.
 *      A cleared row matched none of those five branches but still landed in
 *      `marked`, so the tally did not add up to itself — 3 marked, 2 accounted
 *      for — and `marked > 0` is exactly the test that flips a class to
 *      "marked" on the page. One student's mark taken back off could leave a
 *      class reading as done for the day with nobody's attendance recorded.
 *
 *   2. `unmarkedSchoolDays` keys purely on the DATE being present in the set,
 *      with no reference to status at all. A past day whose only marks were all
 *      cleared therefore still read as done and dropped silently off the list
 *      of days that slipped — and that list is the entire point of this
 *      surface. It is the failure this file cares about most, because nothing
 *      else in the app will ever mention that day again.
 *
 * BOTH are fixed in ONE place — `allRows.filter(isMarked)` where the rows are
 * read — which is why this test drives the real
 * `loadAdviserAttendanceDashboard` rather than the two pure helpers. Calling
 * `tallyToday` directly would only prove the engine works on rows somebody
 * already filtered; the defect was that nobody filtered them. `isMarked` is
 * deliberately left UNMOCKED below for the same reason.
 *
 * Verified RED against the pre-fix code: `marked` came back 3 instead of 2, and
 * the cleared past day was missing from `unmarked`.
 */

import { describe, expect, it, vi } from 'vitest';

import type { DailyEntryRow } from '@/lib/attendance/queries';

const SECTION = 'sec-1';
const TERM = 'term-1';
const TODAY = '2026-08-28';
const SLIPPED = '2026-08-27'; // a past school day whose marks were all cleared
const MARKED_PAST = '2026-08-26';

function entry(over: Partial<DailyEntryRow> & { id: string }): DailyEntryRow {
  return {
    sectionStudentId: 'ss-1',
    termId: TERM,
    date: TODAY,
    status: 'P',
    exReason: null,
    exNote: null,
    periodId: null,
    recordedBy: 'teacher@hfse.test',
    recordedAt: `${TODAY}T01:00:00Z`,
    ...over,
  };
}

// The rows `getDailyForSection` hands back: already deduped to the latest per
// (student, date, period), newest first. A cleared row appears here as the
// WINNER for its key — that is what supersede means — so this is the exact
// shape the dashboard sees in production once anyone clears a mark.
const ROWS: DailyEntryRow[] = [
  // Today: two real marks, plus a third student whose mark was taken back.
  entry({ id: 't1', sectionStudentId: 'ss-1', status: 'P' }),
  entry({ id: 't2', sectionStudentId: 'ss-2', status: 'L' }),
  entry({ id: 't3', sectionStudentId: 'ss-3', status: null }),

  // A past school day on which EVERY mark was cleared. The register is blank
  // for that day and the adviser needs to be told so.
  entry({ id: 'p1', sectionStudentId: 'ss-1', date: SLIPPED, status: null }),
  entry({ id: 'p2', sectionStudentId: 'ss-2', date: SLIPPED, status: null }),

  // A past school day that really was marked — the control. If the filter were
  // too broad this day would start appearing as slipped.
  entry({
    id: 'q1',
    sectionStudentId: 'ss-1',
    date: MARKED_PAST,
    status: 'A',
  }),
];

vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  sgToday: () => TODAY,
}));

vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: () => Promise.resolve([]),
}));

vi.mock('@/lib/classroom/scope', () => ({
  resolveClassroomScope: () => ({
    isOversight: false,
    sectionIds: [SECTION],
    capabilityBySection: { [SECTION]: 'adviser' },
  }),
  canReadAttendance: () => true,
}));

vi.mock('@/lib/attendance/calendar', () => ({
  // Three encodable days: the marked past day, the slipped one, and today.
  getEncodableDatesForTerm: () =>
    Promise.resolve([MARKED_PAST, SLIPPED, TODAY]),
  getDedupedSchoolCalendarForTerm: () => Promise.resolve([]),
}));

// ⚠ PARTIAL MOCK. `isMarked` stays REAL — it is the rule under test, and the
// fix is the production code calling it. Only the loaders are stubbed.
vi.mock('@/lib/attendance/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attendance/queries')>()),
  getDailyForSection: () => Promise.resolve(ROWS),
  getSectionAttendanceSummary: () =>
    Promise.resolve({
      sectionId: SECTION,
      termId: TERM,
      studentCount: 3,
      schoolDays: 3,
      averageAttendancePct: 100,
      totalDaysPresent: 3,
      totalDaysLate: 0,
      totalDaysAbsent: 0,
      totalDaysExcused: 0,
      perfectAttendanceCount: 3,
    }),
  getCompassionateUsageForSection: () => Promise.resolve(new Map()),
  getVacationLeaveUsageForSection: () => Promise.resolve(new Map()),
}));

vi.mock('@/lib/supabase/service', () => {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = () => self;
    self.in = () => self;
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'sections'
            ? [
                {
                  id: SECTION,
                  name: 'P1 Grit',
                  level: { code: 'P1', label: 'Primary 1' },
                },
              ]
            : table === 'section_students'
              ? [
                  { section_id: SECTION, enrollment_status: 'active' },
                  { section_id: SECTION, enrollment_status: 'active' },
                  { section_id: SECTION, enrollment_status: 'active' },
                ]
              : [],
        error: null,
      }).then(resolve);
    return self;
  };
  return { createServiceClient: () => ({ from: (t: string) => chain(t) }) };
});

import { loadAdviserAttendanceDashboard } from '@/lib/attendance/adviser-dashboard-queries';

async function load() {
  const dash = await loadAdviserAttendanceDashboard({
    role: 'teacher',
    userId: 'u-adviser',
    academicYearId: 'ay-1',
    termId: TERM,
  });
  if (!dash) throw new Error('dashboard did not load');
  return dash;
}

describe('loadAdviserAttendanceDashboard — a cleared mark is not a mark', () => {
  it('does not count a cleared student among the students marked today', async () => {
    const [section] = (await load()).sections;
    if (section.today.kind !== 'marked') {
      throw new Error(`expected today to be marked, got ${section.today.kind}`);
    }
    const { tally } = section.today;

    // Two students are marked. The third had their mark taken back off, so
    // today is 2 of 3 done, not 3 of 3.
    expect(tally.marked).toBe(2);
    expect(tally.present).toBe(1);
    expect(tally.late).toBe(1);
    expect(tally.absent).toBe(0);
    expect(tally.excused).toBe(0);
    expect(tally.noClass).toBe(0);

    // THE INVARIANT, stated rather than implied: every student counted in
    // `marked` is accounted for in exactly one bucket. A cleared row counted
    // into `marked` but into no bucket is precisely what broke it.
    expect(
      tally.present + tally.late + tally.absent + tally.excused + tally.noClass
    ).toBe(tally.marked);
  });

  it('lists a past day as slipped when every mark on it was cleared', async () => {
    const [section] = (await load()).sections;

    // The day exists in the rows, so a date-only check called it done. The
    // register for that day is blank and the adviser has to be told.
    expect(section.unmarked).toContain(SLIPPED);

    // The control: a past day that really was marked stays off the list, so
    // the filter is not simply flagging everything.
    expect(section.unmarked).not.toContain(MARKED_PAST);

    // Today is never listed as slipped — it is the job at the top of the page,
    // not a day that got away. Guards against the filter widening the set.
    expect(section.unmarked).not.toContain(TODAY);
  });

  it('reports the class as unmarked when every mark today was cleared', async () => {
    // The end state of the first test taken to its limit: undoing the last
    // mark has to put the class back to "needs marking", not leave it reading
    // as done with an empty tally.
    ROWS.splice(
      0,
      3,
      entry({ id: 't1', sectionStudentId: 'ss-1', status: null }),
      entry({ id: 't2', sectionStudentId: 'ss-2', status: null }),
      entry({ id: 't3', sectionStudentId: 'ss-3', status: null })
    );

    const dash = await load();
    expect(dash.sections[0].today.kind).toBe('unmarked');
    // And the headline says so in plain English, since that is what the
    // adviser actually reads.
    expect(dash.headline).toBe("P1 Grit isn't marked yet.");
  });
});
