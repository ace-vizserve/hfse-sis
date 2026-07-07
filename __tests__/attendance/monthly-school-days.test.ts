/**
 * Tests for countSchoolDaysByMonth() — the pure per-month school-day counter
 * in lib/attendance/queries.ts used by the per-student monthly breakdown.
 *
 * Guards the KD #50/#76 audience-precedence rule: a date carrying BOTH an
 * 'all' baseline row and an audience-specific override (unique key is
 * (term_id, audience, date), migration 037) must count as ONE day, with the
 * specific row's day_type winning.
 */

import { describe, it, expect } from 'vitest';
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
    const out = countSchoolDaysByMonth(rows);
    expect(out.get('2026-03')).toBe(2);
    expect(out.get('2026-04')).toBe(1);
  });

  it('does NOT double-count a date with both an all row and a specific row', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-02', 'primary', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows).get('2026-03')).toBe(1);
  });

  it('specific override wins: all=school_day + specific=holiday → not a school day', () => {
    const rows = [
      day('2026-03-02', 'all', 'school_day'),
      day('2026-03-02', 'primary', 'school_holiday'),
    ];
    expect(countSchoolDaysByMonth(rows).get('2026-03')).toBeUndefined();
  });

  it('specific override wins regardless of row order', () => {
    const rows = [
      day('2026-03-02', 'primary', 'school_holiday'),
      day('2026-03-02', 'all', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows).get('2026-03')).toBeUndefined();
  });

  it('specific school_day over an all holiday counts as a school day', () => {
    const rows = [
      day('2026-03-02', 'all', 'public_holiday'),
      day('2026-03-02', 'secondary', 'school_day'),
    ];
    expect(countSchoolDaysByMonth(rows).get('2026-03')).toBe(1);
  });

  it('non-encodable day types never count', () => {
    const rows = [
      day('2026-03-02', 'all', 'public_holiday'),
      day('2026-03-03', 'all', 'school_holiday'),
      day('2026-03-04', 'all', 'no_class'),
    ];
    expect(countSchoolDaysByMonth(rows).size).toBe(0);
  });

  it('hbl + HBL-overlaid school_holiday are encodable (KD #98)', () => {
    const rows = [
      day('2026-03-02', 'all', 'hbl'),
      day('2026-03-03', 'all', 'school_holiday', true),
      day('2026-03-04', 'all', 'school_holiday', false),
    ];
    expect(countSchoolDaysByMonth(rows).get('2026-03')).toBe(2);
  });
});
