import { describe, expect, it } from 'vitest';
import {
  defaultFilterState,
  filterEvents,
  filterDays,
  type CalendarFilterState,
} from '@/lib/attendance/calendar-filters';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';

const ev = (over: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: 'e',
  termId: 't',
  startDate: '2026-04-10',
  endDate: '2026-04-10',
  label: 'X',
  category: 'school_event',
  audience: 'all',
  tentative: false,
  ...over,
});
const day = (over: Partial<SchoolCalendarRow>): SchoolCalendarRow => ({
  id: 'd',
  termId: 't',
  date: '2026-04-10',
  dayType: 'school_day',
  isHoliday: false,
  label: null,
  audience: 'all',
  hblOverlay: false,
  ...over,
});

describe('calendar filters', () => {
  it('default state passes everything', () => {
    const s = defaultFilterState();
    expect(filterEvents([ev({})], s)).toHaveLength(1);
    expect(filterDays([day({})], s)).toHaveLength(1);
  });

  it('date range bounds both events and days', () => {
    const s: CalendarFilterState = {
      ...defaultFilterState(),
      from: '2026-04-11',
      to: '2026-04-30',
    };
    expect(
      filterEvents([ev({ startDate: '2026-04-10', endDate: '2026-04-10' })], s)
    ).toHaveLength(0);
    expect(
      filterEvents([ev({ startDate: '2026-04-09', endDate: '2026-04-12' })], s)
    ).toHaveLength(1); // overlaps
    expect(filterDays([day({ date: '2026-04-10' })], s)).toHaveLength(0);
    expect(filterDays([day({ date: '2026-04-15' })], s)).toHaveLength(1);
  });

  it('category filter selects matching events only', () => {
    const s: CalendarFilterState = {
      ...defaultFilterState(),
      categories: ['term_exam'],
    };
    expect(
      filterEvents([ev({ category: 'term_exam' }), ev({ category: 'ptc' })], s)
    ).toHaveLength(1);
  });

  it('level filter narrows to the selected audience plus all', () => {
    const s: CalendarFilterState = {
      ...defaultFilterState(),
      level: 'primary',
    };
    const out = filterDays(
      [
        day({ audience: 'all' }),
        day({ audience: 'primary' }),
        day({ audience: 'secondary' }),
      ],
      s
    );
    expect(out.map((d) => d.audience).sort()).toEqual(['all', 'primary']);
  });

  it('status filter keeps only open or only closed days', () => {
    const open = day({ dayType: 'school_day' });
    const closed = day({ dayType: 'public_holiday' });
    expect(
      filterDays([open, closed], { ...defaultFilterState(), status: 'open' })
    ).toEqual([open]);
    expect(
      filterDays([open, closed], { ...defaultFilterState(), status: 'closed' })
    ).toEqual([closed]);
  });
});
