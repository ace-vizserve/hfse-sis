/**
 * Tests for countSchoolDaysByMonth() — the pure per-month school-day counter
 * in lib/attendance/queries.ts used by the per-student monthly breakdown —
 * and for getDedupedSchoolCalendarForTerm(), which applies the same rule to a
 * term's calendar for the register, summary and export.
 *
 * Guards the KD #50/#76 audience-precedence rule: a date carrying BOTH an
 * 'all' baseline row and an audience-specific override (unique key is
 * (term_id, audience, date), migration 037) must count as ONE day, with the
 * most specific row's day_type winning — level code → band → 'all'
 * (migration 196).
 */

import { describe, it, expect, vi } from 'vitest';

// The deduped-calendar reader goes through the service client. The stub
// honours the `.in('audience', …)` list, so a reader that forgets to ask for
// the level code fails here rather than silently reading the band only.
type StubRow = {
  id: string;
  term_id: string;
  date: string;
  day_type: string;
  is_holiday: boolean;
  label: string | null;
  audience: string;
  hbl_overlay: boolean;
};
const { calendarFixture } = vi.hoisted(() => ({
  calendarFixture: [] as StubRow[],
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let audiences: string[] | null = null;
      const api = {
        select: () => api,
        eq: () => api,
        in: (col: string, vals: string[]) => {
          if (col === 'audience') audiences = vals;
          return api;
        },
        order: () =>
          Promise.resolve({
            data: calendarFixture.filter(
              (r) => audiences === null || audiences.includes(r.audience)
            ),
            error: null,
          }),
      };
      return api;
    },
  }),
}));

import { getDedupedSchoolCalendarForTerm } from '@/lib/attendance/calendar';
import {
  countSchoolDaysByMonth,
  type CalendarDayLite,
} from '@/lib/attendance/queries';

function day(
  date: string,
  audience: CalendarDayLite['audience'],
  day_type: CalendarDayLite['day_type'],
  hbl_overlay: boolean | null = false
): CalendarDayLite {
  return { date, audience, day_type, hbl_overlay };
}

describe('countSchoolDaysByMonth — audience precedence (KD #50/#76)', () => {
  it('single all-audience school days count normally (common case)', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-03', 'all', 'school_day'),
      day('2026-04-01', 'all', 'school_day'),
    ];
    const out = countSchoolDaysByMonth(rows, 'P1');
    expect(out.get('2026-03')).toBe(2);
    expect(out.get('2026-04')).toBe(1);
  });

  it('does NOT double-count a date with both an all row and a specific row', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-02', 'primary', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBe(1);
  });

  it('specific override wins: all=school_day + specific=holiday → not a school day', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-02', 'primary', 'school_holiday'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBeUndefined();
  });

  it('specific override wins regardless of row order', () => {
    const rows = [
      day('2026-03-02', 'primary', 'school_holiday'),
      day('2026-03-02', 'all', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBeUndefined();
  });

  it('specific school_day over an all holiday counts as a school day', () => {
    const rows = [
      day('2026-03-02', 'all', 'public_holiday'),
      day('2026-03-02', 'secondary', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows, 'S1').get('2026-03')).toBe(1);
  });

  it('non-encodable day types never count', () => {
    const rows = [
      day('2026-03-02', 'all', 'public_holiday'),
      day('2026-03-03', 'all', 'school_holiday'),
      day('2026-03-04', 'all', 'no_class'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').size).toBe(0);
  });

  it('hbl + HBL-overlaid school_holiday are encodable (KD #98)', () => {
    const rows = [
      day('2026-03-02', 'all', 'hbl'),
      day('2026-03-03', 'all', 'school_holiday', true),
      day('2026-03-04', 'all', 'school_holiday', false),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBe(2);
  });

  it('a P1-only no_class takes one day off P1 and none off P2 (migration 196)', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-03', 'all', 'school_day'),
      day('2026-03-04', 'all', 'school_day'),
      day('2026-03-03', 'P1', 'no_class'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBe(2);
    expect(countSchoolDaysByMonth(rows, 'P2').get('2026-03')).toBe(3);
  });

  it('the level row beats the band row, which beats the all row', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-02', 'primary', 'school_holiday'),
      day('2026-03-02', 'P1', 'hbl'),
    ];
    expect(countSchoolDaysByMonth(rows, 'P1').get('2026-03')).toBe(1);
    expect(countSchoolDaysByMonth(rows, 'P2').get('2026-03')).toBeUndefined();
  });
});

describe('getDedupedSchoolCalendarForTerm — level code → band → all (migration 196)', () => {
  function stub(audience: string, dayType: string, date = '2026-03-02') {
    return {
      id: `${audience}-${date}`,
      term_id: 't1',
      date,
      day_type: dayType,
      is_holiday: dayType !== 'school_day' && dayType !== 'hbl',
      label: null,
      audience,
      hbl_overlay: false,
    };
  }

  it('returns one row per date, the most specific one the section sees', async () => {
    calendarFixture.splice(
      0,
      calendarFixture.length,
      stub('all', 'school_day'),
      stub('primary', 'school_holiday'),
      stub('P1', 'no_class'),
      stub('S1', 'public_holiday'),
      stub('all', 'school_day', '2026-03-03')
    );

    const p1 = await getDedupedSchoolCalendarForTerm('t1', 'P1');
    expect(p1.map((r) => [r.date, r.audience, r.dayType])).toEqual([
      ['2026-03-02', 'P1', 'no_class'],
      ['2026-03-03', 'all', 'school_day'],
    ]);

    const p2 = await getDedupedSchoolCalendarForTerm('t1', 'P2');
    expect(p2.map((r) => [r.date, r.audience])).toEqual([
      ['2026-03-02', 'primary'],
      ['2026-03-03', 'all'],
    ]);

    // Another band's level row is never read for this section.
    const s2 = await getDedupedSchoolCalendarForTerm('t1', 'S2');
    expect(s2.map((r) => [r.date, r.audience])).toEqual([
      ['2026-03-02', 'all'],
      ['2026-03-03', 'all'],
    ]);

    // No level: 'all' only.
    const none = await getDedupedSchoolCalendarForTerm('t1', null);
    expect(none.every((r) => r.audience === 'all')).toBe(true);
  });
});
