import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  decideNonSchoolDay,
  expandSchoolDays,
} from '@/lib/attendance/school-days';
import type { Audience, DayType } from '@/lib/schemas/attendance';

// The rule that decides which days of an approved absence carry a mark.
//
// ⚠ It is the SAME rule that decides whether a teacher may click a cell. It
// used to be a closure inside the daily PATCH handler; Phase 3 needed it for a
// date range, and a second copy of a calendar rule is how the register and the
// sheet start disagreeing about what a school day is. These tests cover both
// the pure decision and the range expander, plus a text check that neither
// caller has grown its own copy back.

type CalRow = {
  term_id: string;
  date: string;
  day_type: string;
  audience: string;
  hbl_overlay: boolean | null;
};

type Term = { id: string; start_date: string | null; end_date: string | null };

/**
 * Minimal PostgREST-shaped stub. Records the filters each builder collects and
 * resolves against the fixtures, so a query that forgets a filter fails here
 * rather than silently over-matching.
 */
function fakeService(fixtures: { terms: Term[]; calendar: CalRow[] }) {
  const calls: string[] = [];

  function builder(table: string, head: boolean) {
    const eq: Record<string, string> = {};
    const inList: Record<string, string[]> = {};
    let gte: string | null = null;
    let lte: string | null = null;

    const api = {
      eq(col: string, val: string) {
        eq[col] = val;
        return api;
      },
      in(col: string, vals: string[]) {
        inList[col] = vals;
        return api;
      },
      gte(col: string, val: string) {
        if (col === 'date') gte = val;
        return api;
      },
      lte(col: string, val: string) {
        if (col === 'date') lte = val;
        return api;
      },
      then(resolve: (r: unknown) => void) {
        calls.push(table);
        if (table === 'terms') {
          return resolve({ data: fixtures.terms, error: null });
        }
        const rows = fixtures.calendar.filter((r) => {
          if (eq.term_id && r.term_id !== eq.term_id) return false;
          if (inList.term_id && !inList.term_id.includes(r.term_id))
            return false;
          if (inList.audience && !inList.audience.includes(r.audience))
            return false;
          if (gte && r.date < gte) return false;
          if (lte && r.date > lte) return false;
          return true;
        });
        return resolve(
          head
            ? { count: rows.length, error: null }
            : { data: rows, error: null }
        );
      },
    };
    return api;
  }

  return {
    calls,
    from(table: string) {
      return {
        select(_cols: string, opts?: { head?: boolean }) {
          return builder(table, opts?.head === true);
        },
      };
    },
  };
}

const TERMS: Term[] = [
  { id: 't1', start_date: '2026-01-05', end_date: '2026-03-13' },
  { id: 't2', start_date: '2026-03-23', end_date: '2026-05-29' },
];

/** Mon–Fri school_day rows for a window, audience 'all'. */
function schoolWeek(termId: string, dates: string[]): CalRow[] {
  return dates.map((date) => ({
    term_id: termId,
    date,
    day_type: 'school_day',
    audience: 'all',
    hbl_overlay: false,
  }));
}

describe('decideNonSchoolDay — the rule itself', () => {
  it('allows a plain school day', () => {
    expect(
      decideNonSchoolDay(
        [{ day_type: 'school_day', audience: 'all', hbl_overlay: false }],
        'primary',
        true
      )
    ).toBe(false);
  });

  it('blocks a public holiday', () => {
    expect(
      decideNonSchoolDay(
        [{ day_type: 'public_holiday', audience: 'all', hbl_overlay: false }],
        'primary',
        true
      )
    ).toBe(true);
  });

  it('allows a school holiday carrying an HBL overlay (migration 051)', () => {
    expect(
      decideNonSchoolDay(
        [{ day_type: 'school_holiday', audience: 'all', hbl_overlay: true }],
        'primary',
        true
      )
    ).toBe(false);
  });

  it('prefers the level-specific row over the "all" row', () => {
    const rows: Array<{
      day_type: DayType;
      audience: Audience;
      hbl_overlay: boolean;
    }> = [
      { day_type: 'school_day', audience: 'all', hbl_overlay: false },
      { day_type: 'public_holiday', audience: 'secondary', hbl_overlay: false },
    ];
    // Secondary sees its own row and is blocked...
    expect(decideNonSchoolDay(rows, 'secondary', true)).toBe(true);
    // ...while primary falls back to 'all' and is not.
    expect(decideNonSchoolDay(rows, 'primary', true)).toBe(false);
  });

  it('blocks an unlisted date when the term IS configured', () => {
    expect(decideNonSchoolDay([], 'primary', true)).toBe(true);
  });

  it('blocks NOTHING when the term has no calendar rows at all', () => {
    // ⚠ Legacy mode, pre-migration-019. Removing this branch would refuse
    // marks on every date of any term nobody has configured yet.
    expect(decideNonSchoolDay([], 'primary', false)).toBe(false);
  });
});

describe('expandSchoolDays', () => {
  const base = {
    academicYearId: 'ay',
    levelType: 'primary' as const,
  };

  it('drops the weekend inside a Friday-to-Tuesday range', async () => {
    // A parent filing Fri 6th → Tue 10th is not claiming the weekend.
    const service = fakeService({
      terms: TERMS,
      calendar: schoolWeek('t1', ['2026-02-06', '2026-02-09', '2026-02-10']),
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-06',
      endDate: '2026-02-10',
    });
    expect(days.map((d) => d.date)).toEqual([
      '2026-02-06',
      '2026-02-09',
      '2026-02-10',
    ]);
  });

  it('drops a public holiday inside the range', async () => {
    const service = fakeService({
      terms: TERMS,
      calendar: [
        ...schoolWeek('t1', ['2026-02-09', '2026-02-11']),
        {
          term_id: 't1',
          date: '2026-02-10',
          day_type: 'public_holiday',
          audience: 'all',
          hbl_overlay: false,
        },
      ],
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-09',
      endDate: '2026-02-11',
    });
    expect(days.map((d) => d.date)).toEqual(['2026-02-09', '2026-02-11']);
  });

  it('carries the right term id across a term boundary', async () => {
    // ⚠ The whole reason term_id is resolved per day. A range spanning the
    // T1/T2 break must land its marks in the term each day belongs to, or one
    // half of them recomputes the wrong rollup.
    const service = fakeService({
      terms: TERMS,
      calendar: [
        ...schoolWeek('t1', ['2026-03-12', '2026-03-13']),
        ...schoolWeek('t2', ['2026-03-23', '2026-03-24']),
      ],
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-03-12',
      endDate: '2026-03-24',
    });
    expect(days).toEqual([
      { date: '2026-03-12', termId: 't1' },
      { date: '2026-03-13', termId: 't1' },
      { date: '2026-03-23', termId: 't2' },
      { date: '2026-03-24', termId: 't2' },
    ]);
  });

  it('drops dates that fall between terms', async () => {
    const service = fakeService({
      terms: TERMS,
      calendar: schoolWeek('t1', ['2026-03-13']),
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-03-13',
      endDate: '2026-03-19', // 14th–19th is the break: no term owns them
    });
    expect(days.map((d) => d.date)).toEqual(['2026-03-13']);
  });

  it('drops dates past the end of the school year', async () => {
    const service = fakeService({
      terms: TERMS,
      calendar: schoolWeek('t2', ['2026-05-29']),
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-05-29',
      endDate: '2026-06-05',
    });
    expect(days.map((d) => d.date)).toEqual(['2026-05-29']);
  });

  it('marks every day when the term has no calendar rows (legacy mode)', async () => {
    const service = fakeService({ terms: TERMS, calendar: [] });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-09',
      endDate: '2026-02-11',
    });
    expect(days.map((d) => d.date)).toEqual([
      '2026-02-09',
      '2026-02-10',
      '2026-02-11',
    ]);
  });

  it('still blocks an unlisted date when the term is configured ELSEWHERE', async () => {
    // ⚠ The trap this guards. The range query returns nothing for these three
    // days, but the term is configured — it just has no rows in this window.
    // Asking "did the WINDOW return rows" instead of "is the TERM configured"
    // would read this as legacy mode and mark straight through a closure.
    const service = fakeService({
      terms: TERMS,
      calendar: schoolWeek('t1', ['2026-01-05', '2026-01-06']),
    });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-09',
      endDate: '2026-02-11',
    });
    expect(days).toEqual([]);
  });

  it('respects audience precedence for a secondary child', async () => {
    const service = fakeService({
      terms: TERMS,
      calendar: [
        ...schoolWeek('t1', ['2026-02-09']),
        {
          term_id: 't1',
          date: '2026-02-09',
          day_type: 'no_class',
          audience: 'secondary',
          hbl_overlay: false,
        },
      ],
    });
    const primary = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-09',
      endDate: '2026-02-09',
    });
    expect(primary.map((d) => d.date)).toEqual(['2026-02-09']);

    const secondary = await expandSchoolDays(service as never, {
      academicYearId: 'ay',
      levelType: 'secondary',
      startDate: '2026-02-09',
      endDate: '2026-02-09',
    });
    expect(secondary).toEqual([]);
  });

  it('returns nothing for a reversed range rather than looping', async () => {
    const service = fakeService({ terms: TERMS, calendar: [] });
    const days = await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-11',
      endDate: '2026-02-09',
    });
    expect(days).toEqual([]);
  });

  it('reads the calendar once for the whole window, not once per day', async () => {
    // The per-date checker costs two round-trips per miss, which is fine for a
    // class-sized submit and is how an approval click starts timing out on a
    // long range.
    const service = fakeService({
      terms: TERMS,
      calendar: schoolWeek('t1', ['2026-02-09', '2026-02-10', '2026-02-11']),
    });
    await expandSchoolDays(service as never, {
      ...base,
      startDate: '2026-02-09',
      endDate: '2026-02-13',
    });
    expect(service.calls.filter((c) => c === 'school_calendar')).toHaveLength(
      1
    );
  });
});

describe('one definition of a school day', () => {
  const root = join(__dirname, '..', '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');

  it('the daily PATCH route uses the shared checker and defines no copy', () => {
    const source = read('app/api/attendance/daily/route.ts');
    expect(source).toContain("from '@/lib/attendance/school-days'");
    expect(source).toContain('createNonSchoolDayChecker(service)');
    // The closure this replaced.
    expect(source).not.toMatch(/function isNonSchoolDay\s*\(/);
    // ...and no second reading of the calendar to decide encodability.
    expect(source).not.toContain('isEncodableDayType');
  });

  it('the register writer uses the shared range expander', () => {
    const source = read('lib/declarations/register.ts');
    expect(source).toContain("from '@/lib/attendance/school-days'");
    expect(source).toContain('expandSchoolDays(');
    expect(source).not.toContain("from('school_calendar')");
  });
});
