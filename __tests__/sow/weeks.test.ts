import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  buildTermWeeks,
  loadTermWeeks,
  reconcileWeeks,
  weekForDate,
  type TermWeek,
} from '@/lib/sow/weeks';

const TERM = { termStart: '2026-03-23', termEnd: '2026-05-29' };

function weekRows(weeks: TermWeek[]) {
  return weeks.filter(
    (w): w is Extract<TermWeek, { kind: 'week' }> => w.kind === 'week'
  );
}

describe('buildTermWeeks', () => {
  it('numbers a full term Monday to Friday', () => {
    const weeks = buildTermWeeks({ ...TERM, closedDays: new Set() });
    expect(weeks).toHaveLength(10);
    expect(weeks[0]).toEqual({
      kind: 'week',
      weekNumber: 1,
      startsOn: '2026-03-23',
      endsOn: '2026-03-27',
      schoolDays: [
        '2026-03-23',
        '2026-03-24',
        '2026-03-25',
        '2026-03-26',
        '2026-03-27',
      ],
    });
    expect(weeks[9]).toMatchObject({ weekNumber: 10, endsOn: '2026-05-29' });
  });

  it('a part-week at the start counts', () => {
    const weeks = buildTermWeeks({
      termStart: '2026-03-25', // Wednesday
      termEnd: '2026-04-03',
      closedDays: new Set(),
    });
    expect(weeks[0]).toMatchObject({
      kind: 'week',
      weekNumber: 1,
      startsOn: '2026-03-25',
      endsOn: '2026-03-27',
    });
    expect(weekRows(weeks)[0].schoolDays).toHaveLength(3);
    expect(weeks[1]).toMatchObject({ weekNumber: 2, startsOn: '2026-03-30' });
  });

  it('a week with no school day is a break, not a number', () => {
    const closed = new Set([
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]);
    const labels = new Map([
      ['2026-04-14', 'Mid-term break'],
      ['2026-04-13', 'Study leave'],
    ]);
    const weeks = buildTermWeeks({
      ...TERM,
      closedDays: closed,
      closedLabels: labels,
    });
    // Mon 23 Mar, 30 Mar, 6 Apr, then the 13 Apr week.
    expect(weeks[3]).toEqual({
      kind: 'break',
      startsOn: '2026-04-13',
      endsOn: '2026-04-17',
      label: 'Study leave',
    });
    expect(weeks[4]).toMatchObject({ kind: 'week', weekNumber: 4 });
    expect(weekRows(weeks)).toHaveLength(9);
  });

  it('a break with no label carries null', () => {
    const closed = new Set([
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]);
    const weeks = buildTermWeeks({ ...TERM, closedDays: closed });
    expect(weeks[3]).toMatchObject({ kind: 'break', label: null });
  });

  it('a week with one school day still counts', () => {
    const closed = new Set([
      '2026-04-03', // Good Friday
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
    ]);
    // Week of 30 Mar: Mon-Wed closed, Thu open, Fri closed.
    const weeks = buildTermWeeks({ ...TERM, closedDays: closed });
    expect(weeks[1]).toMatchObject({
      kind: 'week',
      weekNumber: 2,
      schoolDays: ['2026-04-02'],
    });
  });

  it('never counts a weekend, even if the term starts or ends on one', () => {
    const weeks = buildTermWeeks({
      termStart: '2026-03-21', // Saturday
      termEnd: '2026-03-29', // Sunday
      closedDays: new Set(),
    });
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({
      startsOn: '2026-03-23',
      endsOn: '2026-03-27',
    });
  });
});

describe('weekForDate', () => {
  const weeks = buildTermWeeks({
    ...TERM,
    closedDays: new Set([
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
    ]),
  });

  it('finds the week a weekday falls in', () => {
    expect(weekForDate(weeks, '2026-03-25')?.weekNumber).toBe(1);
  });

  it('returns null on a weekend and on a break', () => {
    expect(weekForDate(weeks, '2026-03-28')).toBeNull();
    expect(weekForDate(weeks, '2026-04-15')).toBeNull();
  });

  it('returns null outside the term', () => {
    expect(weekForDate(weeks, '2026-06-01')).toBeNull();
  });
});

describe('reconcileWeeks', () => {
  const mk = (n: number) => ({ weekNumber: n, content: `w${n}` });

  it('10 stored weeks against 9 term weeks leaves week 10 as surplus', () => {
    const weeks = buildTermWeeks({
      termStart: '2026-03-23',
      termEnd: '2026-05-22', // 9 weeks
      closedDays: new Set(),
    });
    const r = reconcileWeeks(
      Array.from({ length: 10 }, (_, i) => mk(i + 1)),
      weeks
    );
    expect(r.surplus).toEqual([mk(10)]);
    expect(r.missing).toEqual([]);
    expect(r.kept).toHaveLength(9);
    expect(r.kept[0]).toEqual({
      weekNumber: 1,
      content: 'w1',
      startsOn: '2026-03-23',
      endsOn: '2026-03-27',
    });
  });

  it('10 stored weeks against 11 term weeks reports week 11 as missing', () => {
    const weeks = buildTermWeeks({
      termStart: '2026-03-23',
      termEnd: '2026-06-05', // 11 weeks
      closedDays: new Set(),
    });
    const r = reconcileWeeks(
      Array.from({ length: 10 }, (_, i) => mk(i + 1)),
      weeks
    );
    expect(r.missing).toEqual([11]);
    expect(r.surplus).toEqual([]);
    expect(r.kept).toHaveLength(10);
  });
});

// A chainable stand-in for the supabase query builder: every filter returns
// the builder, and awaiting (or .single()) yields the table's canned rows.
function fakeService(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
      b[m] = () => b;
    }
    b.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null });
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? []) } as never;
}

describe('loadTermWeeks', () => {
  it('applies the level audience rule and attaches event labels per week', async () => {
    const service = fakeService({
      terms: [{ start_date: '2026-03-23', end_date: '2026-04-03' }],
      levels: [{ code: 'P1' }],
      school_calendar: [
        // whole-school: open
        ...['23', '24', '25', '26', '27', '30', '31'].map((d) => ({
          date: `2026-03-${d}`,
          day_type: 'school_day',
          audience: 'all',
          hbl_overlay: false,
          label: null,
        })),
        {
          date: '2026-04-01',
          day_type: 'school_day',
          audience: 'all',
          hbl_overlay: false,
          label: null,
        },
        {
          date: '2026-04-02',
          day_type: 'school_day',
          audience: 'all',
          hbl_overlay: false,
          label: null,
        },
        // Good Friday for everyone ...
        {
          date: '2026-04-03',
          day_type: 'school_holiday',
          audience: 'all',
          hbl_overlay: false,
          label: 'Good Friday',
        },
        // ... but P1 has school on 26 Mar via a level row
        {
          date: '2026-03-26',
          day_type: 'school_holiday',
          audience: 'all',
          hbl_overlay: false,
          label: 'Founders Day',
        },
        {
          date: '2026-03-26',
          day_type: 'school_day',
          audience: 'P1',
          hbl_overlay: false,
          label: null,
        },
      ],
      calendar_events: [
        {
          start_date: '2026-03-24',
          end_date: '2026-03-25',
          label: 'Maths Week',
          audience: 'all',
          levels: null,
          section_ids: null,
        },
        {
          start_date: '2026-03-31',
          end_date: '2026-03-31',
          label: 'P6 Fieldtrip',
          audience: 'primary',
          levels: ['P6'],
          section_ids: null,
        },
        {
          start_date: '2026-03-23',
          end_date: '2026-04-03',
          label: 'Section only',
          audience: 'all',
          levels: null,
          section_ids: ['sec-x'],
        },
      ],
    });

    const { weeks, eventsByWeek } = await loadTermWeeks(service, 't1', 'l1');
    expect(weeks).toHaveLength(2);
    // P1 kept 26 Mar (level row beats the 'all' holiday).
    expect(weekRows(weeks)[0].schoolDays).toContain('2026-03-26');
    // Good Friday is closed, and its label shows on week 2.
    expect(weekRows(weeks)[1].schoolDays).not.toContain('2026-04-03');
    expect(eventsByWeek.get(1)).toEqual(['Maths Week']);
    expect(eventsByWeek.get(2)).toEqual(['Good Friday']);
    // A section-only event never leaks into a level's labels.
    expect([...eventsByWeek.values()].flat()).not.toContain('Section only');
  });
});
