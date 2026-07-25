import { describe, expect, it } from 'vitest';
import {
  defaultFilterState,
  filterEvents,
  filterDays,
  hasActiveCalendarFilters,
  isMultiFilterChecked,
  toggleMultiFilterValue,
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

  it('day-type filter selects matching days only, and never touches events', () => {
    const s: CalendarFilterState = {
      ...defaultFilterState(),
      dayTypes: ['public_holiday'],
    };
    const out = filterDays(
      [
        day({ dayType: 'public_holiday' }),
        day({ dayType: 'school_day' }),
        day({ dayType: 'hbl' }),
      ],
      s
    );
    expect(out.map((d) => d.dayType)).toEqual(['public_holiday']);
    // days-only axis — filterEvents is unaffected by dayTypes.
    expect(filterEvents([ev({})], s)).toHaveLength(1);
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

  it('explicit empty dayTypes ([]) hides every day — distinct from null (show-all)', () => {
    const rows = [day({ dayType: 'school_day' }), day({ dayType: 'hbl' })];
    expect(
      filterDays(rows, { ...defaultFilterState(), dayTypes: null })
    ).toHaveLength(2);
    expect(
      filterDays(rows, { ...defaultFilterState(), dayTypes: [] })
    ).toHaveLength(0);
  });

  it('explicit empty categories ([]) hides every event — distinct from null (show-all)', () => {
    const events = [ev({ category: 'ptc' }), ev({ category: 'other' })];
    expect(
      filterEvents(events, { ...defaultFilterState(), categories: null })
    ).toHaveLength(2);
    expect(
      filterEvents(events, { ...defaultFilterState(), categories: [] })
    ).toHaveLength(0);
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

describe('hasActiveCalendarFilters', () => {
  it('is false for the untouched default state', () => {
    expect(hasActiveCalendarFilters(defaultFilterState())).toBe(false);
  });

  it.each([
    ['from', { from: '2026-04-01' }],
    ['to', { to: '2026-04-30' }],
    ['dayTypes narrowed', { dayTypes: ['hbl'] }],
    ['dayTypes show-none', { dayTypes: [] }],
    ['categories narrowed', { categories: ['ptc'] }],
    ['level', { level: 'primary' }],
    ['status', { status: 'open' }],
  ] as const)('is true when %s is set', (_label, patch) => {
    expect(
      hasActiveCalendarFilters({ ...defaultFilterState(), ...patch })
    ).toBe(true);
  });
});

describe('isMultiFilterChecked', () => {
  it('reads as checked for every value when the list is null (show-all)', () => {
    expect(isMultiFilterChecked(null, 'a')).toBe(true);
    expect(isMultiFilterChecked(null, 'z')).toBe(true);
  });

  it('reads as checked only for values present once the list is explicit', () => {
    expect(isMultiFilterChecked(['a', 'b'], 'a')).toBe(true);
    expect(isMultiFilterChecked(['a', 'b'], 'c')).toBe(false);
  });

  it('reads every value as unchecked for an explicit empty list (show-none)', () => {
    expect(isMultiFilterChecked([], 'a')).toBe(false);
  });
});

describe('toggleMultiFilterValue', () => {
  const ALL = ['a', 'b', 'c'] as const;

  it('unchecking one value from show-all (null) produces an explicit "all but that one" list', () => {
    expect(toggleMultiFilterValue(ALL, null, 'b')).toEqual(['a', 'c']);
  });

  it('re-checking the missing value from an explicit list collapses back to null (show-all)', () => {
    expect(toggleMultiFilterValue(ALL, ['a', 'c'], 'b')).toBeNull();
  });

  it('unchecking the last remaining explicit value leaves an explicit [] (show-none) — NOT null', () => {
    // This is the exact bug the null/[] split exists to prevent: if this
    // returned null instead of [], unchecking the last box would silently
    // snap every checkbox back to checked (null reads as "show all").
    const result = toggleMultiFilterValue(ALL, ['a'], 'a');
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it('checking an additional value onto a non-empty explicit list just appends it', () => {
    expect(toggleMultiFilterValue(ALL, ['a'], 'b')).toEqual(['a', 'b']);
  });

  it('checking a value back onto an explicit empty list (show-none → one checked)', () => {
    expect(toggleMultiFilterValue(ALL, [], 'a')).toEqual(['a']);
  });
});
