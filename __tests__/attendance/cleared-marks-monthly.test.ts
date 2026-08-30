/**
 * A cleared day is excluded from the per-student monthly breakdown.
 *
 * Migration 134 made `attendance_daily.status` nullable — a NULL row is how a
 * mark is UNDONE, appended like any correction and superseding the prior mark
 * by `recorded_at` — so the newest row for a day may carry no status at all.
 *
 * `getMonthlyBreakdown` bucketed those rows with
 *
 *     byMonth.get(key)![r.status] += 1
 *
 * against an object keyed by the five stored codes.
 *
 * ⚠ WHAT THAT ACTUALLY DOES, MEASURED RATHER THAN REASONED — because the
 * obvious reading of it is WRONG and this test was written against the broken
 * code to find out. `obj[null] += 1` stringifies the key, so it evaluates to
 * `obj['null'] = undefined + 1`, i.e. **NaN written to a NEW `'null'`
 * property**. It does not touch P, L, EX, A or NC. So the NaN is real, but it
 * lands on a junk field nothing reads, and `present` / `late` / `excused` /
 * `absent` came out CORRECT — the cleared day was already falling out of the
 * buckets by accident. Three of the four tests below pass against the unfixed
 * code for exactly that reason, and they are kept as regression cover, not
 * claimed as the catch.
 *
 * THE DEFECT THAT IS REAL is the one the fourth test names: the cleared day
 * still put its MONTH in `byMonth`, so a month whose every mark has been taken
 * back still renders a row. With a seeded calendar that row reads
 * `schoolDays: 20, present: 0, pct: 0` — **a fabricated 0% attendance month on
 * a student's record**, for a month in which nothing is marked at all. That is
 * the parent-facing harm, and it is what the last two tests pin.
 *
 * The rule the fix applies, at this site and the four others: a cleared row
 * means NOT MARKED, so it is EXCLUDED — never bucketed, never coerced to a
 * status, never counted as present or absent. That is the same answer the
 * database already gives. `recompute_attendance_rollup` counts with
 * `count(*) filter (...)`, and because `NULL <> 'NC'` evaluates to NULL rather
 * than TRUE, a cleared row falls out of school_days, present, late, excused and
 * absent alike. The TypeScript has to agree with the SQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SS = 'ss-1';
const TERM = 'term-1';

type DailyRow = {
  id: string;
  section_student_id: string;
  term_id: string;
  date: string;
  status: string | null;
  ex_reason: string | null;
  ex_note: string | null;
  period_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

function row(over: Partial<DailyRow> & { id: string; date: string }): DailyRow {
  return {
    section_student_id: SS,
    term_id: TERM,
    status: 'P',
    ex_reason: null,
    ex_note: null,
    period_id: null,
    recorded_by: 'teacher@hfse.test',
    recorded_at: `${over.date}T01:00:00Z`,
    ...over,
  };
}

let DAILY: DailyRow[] = [];

// The calendar is left EMPTY on purpose. `getMonthlyBreakdown` then falls back
// to its records-based school-day count (`present + absent`), which keeps this
// test on the attendance rows — the thing under test — instead of on calendar
// seeding. The fallback is a real production path (legacy data, an unseeded
// range), not a test-only shortcut.
let CALENDAR: unknown[] = [];

vi.mock('@/lib/supabase/service', () => {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    const data = () => {
      if (table === 'attendance_daily') {
        // The server's ordering, reproduced: date desc then recorded_at desc,
        // which is what the supersede-by-latest dedupe relies on.
        return [...DAILY].sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.recorded_at.localeCompare(a.recorded_at)
        );
      }
      if (table === 'school_calendar') return CALENDAR;
      return [];
    };
    self.select = () => self;
    self.eq = () => self;
    self.in = () => self;
    self.gte = () => self;
    self.lte = () => self;
    self.order = () => self;
    self.range = (from: number, to: number) =>
      Promise.resolve({ data: data().slice(from, to + 1), error: null });
    // `section_students` → the enrolment lookup, which asks for the section
    // join. No level_id means no `levels` read and audience 'all' only.
    self.maybeSingle = () =>
      Promise.resolve({
        data:
          table === 'section_students'
            ? {
                section_id: 'sec-1',
                sections: { level_id: null, academic_year_id: null },
              }
            : null,
        error: null,
      });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: data(), error: null }).then(resolve);
    return self;
  };
  return { createServiceClient: () => ({ from: (t: string) => chain(t) }) };
});

import { getMonthlyBreakdown } from '@/lib/attendance/queries';

beforeEach(() => {
  CALENDAR = [];
  DAILY = [];
});

describe('getMonthlyBreakdown — a cleared day is not a mark', () => {
  it('never reports a fabricated 0% month for days nobody has marked', async () => {
    // ⚠ THE ONE THAT MATTERS, and the shape production actually has: a seeded
    // calendar. The student's March marks were all cleared — the register is
    // blank for the month — but `byMonth` still held the month, so the row was
    // built and `schoolDays` came from the CALENDAR (20 days), not from the
    // rows. Result: "March 2026 · 20 school days · 0 present · 0%" on a
    // student's attendance record, for a month with nothing marked in it.
    //
    // A real 0% month and a month nobody has marked look identical on screen,
    // and only one of them is true.
    CALENDAR = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-03-${String(i + 2).padStart(2, '0')}`,
      audience: 'all',
      day_type: 'school_day',
      hbl_overlay: false,
    }));

    DAILY = [
      row({
        id: 'd1-mark',
        date: '2026-03-02',
        status: 'P',
        recorded_at: '2026-03-02T01:00:00Z',
      }),
      row({
        id: 'd1-cleared',
        date: '2026-03-02',
        status: null,
        recorded_at: '2026-03-02T09:00:00Z',
      }),
    ];

    expect(await getMonthlyBreakdown(SS, TERM)).toEqual([]);
  });

  it('does not write NaN into any figure the page renders', async () => {
    DAILY = [
      row({ id: 'd1', date: '2026-03-02', status: 'P' }),
      row({ id: 'd2', date: '2026-03-03', status: 'A' }),
      // Cleared: the teacher marked this day, then took the mark back off it.
      // Both rows are in the ledger; the NULL one is newer, so it wins the
      // supersede and is what the breakdown sees.
      row({
        id: 'd3-mark',
        date: '2026-03-04',
        status: 'A',
        recorded_at: '2026-03-04T01:00:00Z',
      }),
      row({
        id: 'd3-cleared',
        date: '2026-03-04',
        status: null,
        recorded_at: '2026-03-04T09:00:00Z',
      }),
    ];

    const [march] = await getMonthlyBreakdown(SS, TERM);

    // ⚠ These PASSED against the unfixed code — see the header. The NaN went
    // to `byMonth.get(key)!['null']`, a property nothing reads, so the five
    // real counters were never touched. Kept as the regression guard that
    // would fire if the bucketing were ever "fixed" by coercing a cleared row
    // onto one of the five codes instead of excluding it.
    expect(Number.isNaN(march.present)).toBe(false);
    expect(Number.isNaN(march.absent)).toBe(false);
    expect(Number.isNaN(march.late)).toBe(false);
    expect(Number.isNaN(march.excused)).toBe(false);
    expect(Number.isNaN(march.schoolDays)).toBe(false);
    expect(march.pct === null || !Number.isNaN(march.pct)).toBe(true);

    // And the counts are right, not merely finite: the cleared day is gone
    // from every bucket, so March is 1 present + 1 absent over 2 school days.
    expect(march).toMatchObject({
      month: '2026-03',
      present: 1,
      absent: 1,
      late: 0,
      excused: 0,
      schoolDays: 2,
      pct: 50,
    });
  });

  it('reads exactly as if the day had never been marked at all', async () => {
    // The strongest statement of the rule: clearing a mark returns the day to
    // unmarked, so the breakdown must be byte-for-byte what it would have been
    // had nobody ever touched that day. Anything else — bucketing it, counting
    // it as a school day with no mark — shows up as a difference here.
    const marked = [
      row({ id: 'd1', date: '2026-03-02', status: 'P' }),
      row({ id: 'd2', date: '2026-03-03', status: 'A' }),
    ];

    DAILY = marked;
    const withoutTheDay = await getMonthlyBreakdown(SS, TERM);

    DAILY = [
      ...marked,
      row({
        id: 'd3-mark',
        date: '2026-03-04',
        status: 'EX',
        ex_reason: 'mc',
        recorded_at: '2026-03-04T01:00:00Z',
      }),
      row({
        id: 'd3-cleared',
        date: '2026-03-04',
        status: null,
        recorded_at: '2026-03-04T09:00:00Z',
      }),
    ];
    const withTheDayCleared = await getMonthlyBreakdown(SS, TERM);

    expect(withTheDayCleared).toEqual(withoutTheDay);
  });

  it('still counts a day whose mark was cleared and then re-marked', async () => {
    // The inverse, so the filter cannot be "drop any day that has ever been
    // cleared". Supersede is by `recorded_at`: the newest row here is a real
    // mark, so the day counts.
    DAILY = [
      row({
        id: 'd1-mark',
        date: '2026-03-02',
        status: 'A',
        recorded_at: '2026-03-02T01:00:00Z',
      }),
      row({
        id: 'd1-cleared',
        date: '2026-03-02',
        status: null,
        recorded_at: '2026-03-02T09:00:00Z',
      }),
      row({
        id: 'd1-remark',
        date: '2026-03-02',
        status: 'P',
        recorded_at: '2026-03-02T11:00:00Z',
      }),
    ];

    const [march] = await getMonthlyBreakdown(SS, TERM);
    expect(march).toMatchObject({ present: 1, absent: 0, schoolDays: 1 });
  });

  it('returns no rows at all when every day in the month is cleared', async () => {
    // Not an empty month full of zeroes, and certainly not a month of NaN —
    // the student has nothing marked, so there is nothing to report.
    DAILY = [
      row({
        id: 'd1-mark',
        date: '2026-03-02',
        status: 'P',
        recorded_at: '2026-03-02T01:00:00Z',
      }),
      row({
        id: 'd1-cleared',
        date: '2026-03-02',
        status: null,
        recorded_at: '2026-03-02T09:00:00Z',
      }),
    ];

    expect(await getMonthlyBreakdown(SS, TERM)).toEqual([]);
  });
});
