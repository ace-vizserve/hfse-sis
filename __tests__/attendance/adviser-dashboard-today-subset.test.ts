/**
 * The adviser dashboard used to ask `getDailyForSection` for the same section
 * TWICE per class in one `Promise.all`: once for `{ fromDate: today, toDate:
 * today }` and once for `{ toDate: today }`. The second window contains the
 * first, so the narrow read was re-fetching rows the wide read already had —
 * and each `getDailyForSection` costs a roster read plus a paginated daily
 * read, so the duplicate was two round trips per class, every load.
 *
 * `todayMarks` is now derived by filtering `allMarks`. THIS FILE IS THE PROOF
 * THAT IT MAY BE, and it was written and run GREEN against the two-fetch
 * version before the fetch was deleted.
 *
 * WHY THE SUBSET HOLDS, stated so a reader can check it rather than trust it:
 *
 *   1. SAME SCOPE. Both calls pass the same sectionId and termId, so both
 *      resolve the same `section_students` roster and filter
 *      `.eq('term_id')` / `.in('section_student_id')` identically. The only
 *      difference is the lower date bound.
 *
 *   2. THE DEDUPE IS PARTITIONED BY DATE. `getDailyForSection` keeps the latest
 *      row per `section_student_id|date|period_id` — the key CONTAINS the date,
 *      so rows from earlier dates can never displace a winner on today. Adding
 *      earlier days to the result set therefore cannot change which of today's
 *      corrections survives. (If the key had omitted the date, this item would
 *      have been exempt.)
 *
 *   3. ORDER SURVIVES TOO. The server orders by `recorded_at desc` across the
 *      whole set and `fetchAllPages` walks pages in order, so filtering the
 *      wide result down to today preserves the same relative order the narrow
 *      read returns — hence `toEqual`, not a set comparison.
 *
 *   4. THE WIDE READ IS NOT WINDOWED. The brief's exemption case was "allMarks
 *      is paginated to a window that can exclude today". It is not:
 *      `fetchAllPages` walks until a short page (100 pages x 1000 = 100K
 *      ceiling) and the worst measured section-term is 1,610 rows. The
 *      pagination test below crosses a page boundary on purpose so this is
 *      exercised rather than asserted.
 *
 * The fake client here APPLIES the date filters, unlike the counting harness —
 * that is the whole point, since the claim under test is about what the two
 * date windows return.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TERM = 'term-1';
const SECTION = 'sec-1';
const TODAY = '2026-08-29';
const ROSTER = ['ss-1', 'ss-2', 'ss-3'];

type Row = {
  id: string;
  section_student_id: string;
  term_id: string;
  date: string;
  status: string;
  ex_reason: string | null;
  ex_note: string | null;
  period_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

function row(over: Partial<Row> & { id: string }): Row {
  return {
    section_student_id: 'ss-1',
    term_id: TERM,
    date: TODAY,
    status: 'present',
    ex_reason: null,
    ex_note: null,
    period_id: null,
    recorded_by: 'teacher@hfse.test',
    recorded_at: '2026-08-29T01:00:00Z',
    ...over,
  };
}

let ROWS: Row[] = [];

/** PostgREST's response cap, and the page size `fetchAllPages` walks in. */
const PAGE_SIZE = 1000;

vi.mock('@/lib/supabase/service', () => {
  const chain = (table: string) => {
    const filters: {
      gte?: string;
      lte?: string;
      termId?: string;
      ids?: string[];
    } = {};
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = (col: string, val: string) => {
      if (col === 'term_id') filters.termId = val;
      return self;
    };
    self.in = (_col: string, vals: string[]) => {
      filters.ids = vals;
      return self;
    };
    self.order = () => self;
    self.gte = (_col: string, v: string) => {
      filters.gte = v;
      return self;
    };
    self.lte = (_col: string, v: string) => {
      filters.lte = v;
      return self;
    };
    const matching = () =>
      ROWS.filter(
        (r) =>
          (filters.termId === undefined || r.term_id === filters.termId) &&
          (filters.ids === undefined ||
            filters.ids.includes(r.section_student_id)) &&
          (filters.gte === undefined || r.date >= filters.gte) &&
          (filters.lte === undefined || r.date <= filters.lte)
      )
        // The server's ordering, reproduced: recorded_at desc across the whole
        // filtered set, which is what the dedupe relies on.
        .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    self.range = (from: number, to: number) =>
      Promise.resolve({ data: matching().slice(from, to + 1), error: null });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'section_students' ? ROSTER.map((id) => ({ id })) : [],
        error: null,
      }).then(resolve);
    return self;
  };
  return { createServiceClient: () => ({ from: (t: string) => chain(t) }) };
});

import { getDailyForSection } from '@/lib/attendance/queries';

beforeEach(() => {
  ROWS = [
    // Today, one student corrected twice — the later row must win in BOTH
    // windows, which is the dedupe half of the claim.
    row({
      id: 'today-1-old',
      section_student_id: 'ss-1',
      status: 'absent',
      recorded_at: '2026-08-29T01:00:00Z',
    }),
    row({
      id: 'today-1-new',
      section_student_id: 'ss-1',
      status: 'present',
      recorded_at: '2026-08-29T09:30:00Z',
    }),
    row({
      id: 'today-2',
      section_student_id: 'ss-2',
      status: 'late',
      recorded_at: '2026-08-29T08:15:00Z',
    }),
    // A period-scoped mark on today: same student and date, different period,
    // so it is a DIFFERENT dedupe key and must survive alongside the above.
    row({
      id: 'today-2-p2',
      section_student_id: 'ss-2',
      period_id: 'p2',
      status: 'present',
      recorded_at: '2026-08-29T10:00:00Z',
    }),
    // Earlier days, including one whose recorded_at is LATER than some of
    // today's rows (a backdated correction entered this afternoon). This is
    // the row that would break the claim if the dedupe key omitted the date.
    row({
      id: 'past-1',
      section_student_id: 'ss-1',
      date: '2026-08-28',
      status: 'absent',
      recorded_at: '2026-08-29T23:00:00Z',
    }),
    row({
      id: 'past-2',
      section_student_id: 'ss-2',
      date: '2026-08-27',
      status: 'present',
      recorded_at: '2026-08-27T08:00:00Z',
    }),
    row({
      id: 'past-3',
      section_student_id: 'ss-3',
      date: '2026-08-26',
      status: 'excused',
      ex_reason: 'mc',
      recorded_at: '2026-08-26T08:00:00Z',
    }),
    // Tomorrow — outside BOTH windows (`toDate: today` on each), so it must
    // appear in neither. Guards against the derived version accidentally
    // widening the set.
    row({
      id: 'future-1',
      section_student_id: 'ss-1',
      date: '2026-08-30',
      recorded_at: '2026-08-30T08:00:00Z',
    }),
  ];
});

describe("todayMarks is a strict subset of allMarks — the adviser dashboard's derivation", () => {
  it('filtering the wide read to today equals the separately fetched narrow read', async () => {
    const fetched = await getDailyForSection(SECTION, TERM, {
      fromDate: TODAY,
      toDate: TODAY,
    });
    const allMarks = await getDailyForSection(SECTION, TERM, {
      toDate: TODAY,
    });

    const derived = allMarks.filter((m) => m.date === TODAY);

    expect(derived).toEqual(fetched);
    // Not vacuously equal: the narrow read really did return the deduped
    // today rows, and the backdated correction really is in the wide one.
    expect(fetched.map((m) => m.id).sort()).toEqual([
      'today-1-new',
      'today-2',
      'today-2-p2',
    ]);
    expect(allMarks.map((m) => m.id)).toContain('past-1');
    expect(allMarks.map((m) => m.id)).not.toContain('future-1');
  });

  it("holds when today's marks fall on the wide read's SECOND page", async () => {
    // The exemption case the brief named: a wide read windowed such that it
    // could exclude today. `fetchAllPages` walks until a short page, so it
    // cannot — and this proves it where it would actually hurt.
    //
    // A full page of backdated corrections is seeded with recorded_at LATER
    // than every one of today's marks. Ordering is `recorded_at desc`, so
    // those 1,000 rows fill page one entirely and today's marks are only
    // reachable on page two. A read that stopped at the cap — which is
    // precisely what this function did before it was paginated (see
    // daily-pagination.test.ts, 1,610 rows measured in production) — would
    // return today as EMPTY here, and the derived version would silently
    // report an unmarked class.
    for (let i = 0; i < PAGE_SIZE; i += 1) {
      ROWS.push(
        row({
          id: `bulk-${i}`,
          section_student_id: 'ss-3',
          date: '2026-08-25',
          period_id: `bulk-p${i}`,
          recorded_at: `2026-08-29T23:59:${String(i % 60).padStart(2, '0')}Z`,
        })
      );
    }

    const fetched = await getDailyForSection(SECTION, TERM, {
      fromDate: TODAY,
      toDate: TODAY,
    });
    const allMarks = await getDailyForSection(SECTION, TERM, {
      toDate: TODAY,
    });

    // The premise: today really is past the first page.
    expect(allMarks.slice(0, PAGE_SIZE).some((m) => m.date === TODAY)).toBe(
      false
    );

    expect(allMarks.filter((m) => m.date === TODAY)).toEqual(fetched);
    expect(fetched).toHaveLength(3);
  });

  it('the dedupe key contains the date — earlier days cannot displace today', async () => {
    // Stated as its own assertion because it is the load-bearing half of the
    // argument: `past-1` has the LATEST recorded_at of any row, and if the
    // dedupe key were `student|period` it would have swallowed ss-1's mark for
    // today the moment the two windows were merged.
    const allMarks = await getDailyForSection(SECTION, TERM, {
      toDate: TODAY,
    });
    const ss1 = allMarks.filter((m) => m.sectionStudentId === 'ss-1');
    expect(ss1.map((m) => m.id).sort()).toEqual(['past-1', 'today-1-new']);
  });
});
