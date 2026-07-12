import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import type { SchoolCalendarRow } from '@/lib/attendance/calendar';

// Real SchoolCalendarRow shape (lib/attendance/calendar.ts) — camelCase,
// not the snake_case day_type/hbl_overlay the brief's illustrative test used.
const ROW = (
  date: string,
  audience: 'all' | 'primary' | 'secondary' = 'all'
): SchoolCalendarRow => ({
  id: `r-${date}-${audience}`,
  termId: 't1',
  date,
  dayType: 'school_day',
  isHoliday: false,
  label: null,
  audience,
  hblOverlay: false,
});

describe('useCalendarIndex — hasRowByIso', () => {
  it('marks a date with an explicit row as present', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17')], [], 'all')
    );
    expect(result.current.hasRowByIso.has('2026-07-17')).toBe(true);
  });

  it('does NOT mark a date with zero rows as present', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17')], [], 'all')
    );
    expect(result.current.hasRowByIso.has('2026-07-23')).toBe(false);
  });

  it('marks a date present when only a level-specific row exists (no "all" row)', () => {
    const { result } = renderHook(() =>
      useCalendarIndex([ROW('2026-07-17', 'primary')], [], 'primary')
    );
    expect(result.current.hasRowByIso.has('2026-07-17')).toBe(true);
  });
});
