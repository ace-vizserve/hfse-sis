/**
 * Regression tests for the attendance `day-type` drill target
 * (`lib/attendance/drill.ts`):
 *
 *   1. The calendar query now filters to `audience='all'`, matching the
 *      day-type donut's own query (`getDayTypeDistributionRange` in
 *      lib/attendance/dashboard.ts). Without this filter, an
 *      audience-specific override row (KD #76 — primary/secondary can each
 *      carry their own row for the same date) could surface in the drill
 *      even though the donut never counted it.
 *   2. The segment→enum reverse-lookup used to click a donut slice into a
 *      filtered drill is now built once at module load by inverting the
 *      shared `DAY_TYPE_LABELS` map (lib/schemas/attendance.ts), instead of
 *      a hand-duplicated literal. This confirms every day type still
 *      round-trips label → enum correctly.
 *
 * Mocking shape mirrors __tests__/admissions/drill.test.ts: `next/cache`
 * stubbed to a passthrough, `@/lib/supabase/service` stubbed to a fake
 * PostgREST chain that applies `.eq()`/`.in()` filters against fixture rows.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

type Row = Record<string, unknown>;

function makeQueryChain(initialData: Row[]) {
  let data = initialData;
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      data = data.filter((r) => r[col] === val);
      return chain;
    },
    in: (col: string, vals: unknown[]) => {
      data = data.filter((r) => vals.includes(r[col]));
      return chain;
    },
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    range: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

// One row per day type at audience='all' (the donut's own scope), plus one
// audience='primary' override row on the same date as the school_day row —
// this is exactly the KD #76 shape that used to leak into the drill.
const ALL_AUDIENCE_ROWS: Row[] = [
  {
    term_id: 't1',
    date: '2026-01-05',
    day_type: 'school_day',
    label: null,
    audience: 'all',
  },
  {
    term_id: 't1',
    date: '2026-01-06',
    day_type: 'hbl',
    label: null,
    audience: 'all',
  },
  {
    term_id: 't1',
    date: '2026-01-07',
    day_type: 'public_holiday',
    label: "New Year's Day",
    audience: 'all',
  },
  {
    term_id: 't1',
    date: '2026-01-08',
    day_type: 'school_holiday',
    label: null,
    audience: 'all',
  },
  {
    term_id: 't1',
    date: '2026-01-09',
    day_type: 'no_class',
    label: null,
    audience: 'all',
  },
];
const PRIMARY_OVERRIDE_ROW: Row = {
  term_id: 't1',
  date: '2026-01-05',
  day_type: 'no_class',
  label: 'Primary-only override',
  audience: 'primary',
};

const MOCK_CALENDAR_ROWS = [...ALL_AUDIENCE_ROWS, PRIMARY_OVERRIDE_ROW];

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'academic_years') {
        return makeQueryChain([{ id: 'ay1', ay_code: 'AY2026' }]);
      }
      if (table === 'terms') {
        return makeQueryChain([
          { id: 't1', term_number: 1, academic_year_id: 'ay1' },
        ]);
      }
      if (table === 'school_calendar') {
        return makeQueryChain([...MOCK_CALENDAR_ROWS]);
      }
      // sections / levels / section_students / students — empty is fine,
      // the calendar-day drill path never touches roster data.
      return makeQueryChain([]);
    },
  })),
}));

import { buildAttendanceDrillRows } from '@/lib/attendance/drill';
import { DAY_TYPE_LABELS } from '@/lib/schemas/attendance';
import type { CalendarDayRow } from '@/lib/attendance/drill';

describe("day-type drill — audience='all' filter", () => {
  it('excludes an audience-specific override row that the donut never counted', async () => {
    const rows = (await buildAttendanceDrillRows({
      ayCode: 'AY2026',
      target: 'day-type',
    })) as CalendarDayRow[];

    // Only the 5 audience='all' rows should come back — the primary
    // override row (same date as the school_day row) must be excluded.
    expect(rows).toHaveLength(ALL_AUDIENCE_ROWS.length);
    expect(rows.some((r) => r.label === 'Primary-only override')).toBe(false);
    // The school_day row for 2026-01-05 is still present (its own
    // audience='all' row is unaffected by the excluded override).
    expect(rows.find((r) => r.date === '2026-01-05')?.dayType).toBe(
      'school_day'
    );
  });
});

describe('day-type drill — segment label → enum round-trip', () => {
  it.each(Object.entries(DAY_TYPE_LABELS))(
    'clicking the %s / "%s" segment filters to dayType=%s',
    async (enumValue, label) => {
      const rows = (await buildAttendanceDrillRows({
        ayCode: 'AY2026',
        target: 'day-type',
        segment: label,
      })) as CalendarDayRow[];

      expect(rows).toHaveLength(1);
      expect(rows[0].dayType).toBe(enumValue);
    }
  );

  it('an unrecognized segment value falls through unchanged (defensive default)', async () => {
    const rows = (await buildAttendanceDrillRows({
      ayCode: 'AY2026',
      target: 'day-type',
      segment: 'school_day', // raw enum, not a label — not in the map
    })) as CalendarDayRow[];

    // Falls back to using the raw segment string as the target, which does
    // match the raw enum value here — same defensive behaviour as before.
    expect(rows).toHaveLength(1);
    expect(rows[0].dayType).toBe('school_day');
  });
});
