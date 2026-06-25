import { describe, expect, it } from 'vitest';
import {
  resolveColumnTag,
  eachDateInclusive,
  monthsInRange,
} from '@/lib/attendance/sheet-columns';
import type { CalendarEventRow } from '@/lib/attendance/calendar';

function ev(
  category: CalendarEventRow['category'],
  date = '2026-07-01'
): CalendarEventRow {
  return {
    id: 'e',
    termId: 't',
    startDate: date,
    endDate: date,
    label: 'x',
    category,
    audience: 'all',
    tentative: false,
  };
}

describe('resolveColumnTag', () => {
  it('tags holidays from day_type', () => {
    expect(resolveColumnTag({ dayType: 'public_holiday', events: [] })).toBe(
      'PH'
    );
    expect(resolveColumnTag({ dayType: 'school_holiday', events: [] })).toBe(
      'SH'
    );
    expect(resolveColumnTag({ dayType: 'no_class', events: [] })).toBe('NC');
  });
  it('shows EX for an exam event on a school day', () => {
    expect(
      resolveColumnTag({ dayType: 'school_day', events: [ev('term_exam')] })
    ).toBe('EX');
  });
  it('shows SE for any non-exam event on a school day', () => {
    expect(
      resolveColumnTag({ dayType: 'school_day', events: [ev('school_event')] })
    ).toBe('SE');
  });
  it('exam wins over a co-located non-exam event', () => {
    expect(
      resolveColumnTag({
        dayType: 'school_day',
        events: [ev('school_event'), ev('term_exam')],
      })
    ).toBe('EX');
  });
  it('holiday day-type wins over an event on the same date', () => {
    expect(
      resolveColumnTag({
        dayType: 'public_holiday',
        events: [ev('school_event')],
      })
    ).toBe('PH');
  });
  it('HBL day-type with no event tags HBL; a plain school day is untagged', () => {
    expect(resolveColumnTag({ dayType: 'hbl', events: [] })).toBe('HBL');
    expect(resolveColumnTag({ dayType: 'school_day', events: [] })).toBeNull();
    expect(resolveColumnTag({ dayType: null, events: [] })).toBeNull();
  });
});

describe('eachDateInclusive', () => {
  it('enumerates every calendar date incl weekends, inclusive of both ends', () => {
    expect(eachDateInclusive('2026-06-29', '2026-07-02')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
    ]);
  });
});

describe('monthsInRange', () => {
  it('lists every YYYY-MM the window touches', () => {
    expect(monthsInRange('2026-06-29', '2026-09-04')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });
});
