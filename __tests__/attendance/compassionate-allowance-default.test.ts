/**
 * Regression test for the compassionate-allowance dead-wiring bug: the
 * attendance compassionate-quota functions used to hardcode `?? 5` instead
 * of reading `school_config.default_compassionate_allowance_per_year`
 * (lib/sis/school-config.ts), so editing that field on
 * /sis/admin/school-config had zero effect. Fixed to mirror
 * getVacationLeaveUsage's `override ?? schoolConfig.default...` pattern.
 *
 * The mocked school-default value (7) is deliberately NOT the old hardcoded
 * literal (5) or the DEFAULT_SCHOOL_CONFIG fallback (5) — if either
 * `getCompassionateUsage` or `getCompassionateUsageForSection` regresses to
 * reading a hardcoded 5, these assertions fail loudly.
 */

import { describe, expect, it, vi } from 'vitest';

const SCHOOL_DEFAULT = 7;

// Fake service client. `from()` dispatches per table; every chain method
// resolves to a deterministic result matching the query shape each function
// actually issues (see lib/attendance/queries.ts + lib/sis/school-config.ts).
vi.mock('@/lib/supabase/service', () => {
  const makeChain = (result: { data: unknown; error: null }) => ({
    select: () => makeChain(result),
    eq: () => makeChain(result),
    in: () => makeChain(result),
    order: () => makeChain(result),
    // `.range()` is part of the chain now: the quota tallies and the daily
    // grid page through `fetchAllPages` since the real worst case (5,925 rows
    // for one section, measured 2026-08-10) passed PostgREST's 1,000-row cap.
    // Returning the whole fixture on the first page ends the walk immediately.
    range: () => makeChain(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  });

  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'school_config') {
          return makeChain({
            data: { default_compassionate_allowance_per_year: SCHOOL_DEFAULT },
            error: null,
          });
        }
        if (table === 'students') {
          // No student-level override — allowance should fall through to
          // the school default.
          return makeChain({
            data: { urgent_compassionate_allowance: null },
            error: null,
          });
        }
        if (table === 'section_students') {
          // No AY enrolments found — both functions short-circuit to
          // used: 0 without needing attendance_daily rows.
          return makeChain({ data: [], error: null });
        }
        return makeChain({ data: [], error: null });
      },
    })),
  };
});

import {
  getCompassionateUsage,
  getCompassionateUsageForSection,
} from '@/lib/attendance/queries';

describe('compassionate-allowance default wiring', () => {
  it('getCompassionateUsage reads the school-config default when no student override exists', async () => {
    const usage = await getCompassionateUsage('student-1', 'ay-1');
    expect(usage.allowance).toBe(SCHOOL_DEFAULT);
    expect(usage.remaining).toBe(SCHOOL_DEFAULT);
  });
});

describe('compassionate-allowance override precedence (regression guard)', () => {
  it('a student-level override still wins over the school default', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/service', () => {
      const makeChain = (result: { data: unknown; error: null }) => ({
        select: () => makeChain(result),
        eq: () => makeChain(result),
        in: () => makeChain(result),
        order: () => makeChain(result),
        range: () => makeChain(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      });
      return {
        createServiceClient: vi.fn(() => ({
          from: (table: string) => {
            if (table === 'school_config') {
              return makeChain({
                data: {
                  default_compassionate_allowance_per_year: SCHOOL_DEFAULT,
                },
                error: null,
              });
            }
            if (table === 'students') {
              return makeChain({
                data: { urgent_compassionate_allowance: 3 },
                error: null,
              });
            }
            return makeChain({ data: [], error: null });
          },
        })),
      };
    });
    const { getCompassionateUsage: getUsageWithOverride } =
      await import('@/lib/attendance/queries');
    const usage = await getUsageWithOverride('student-override', 'ay-1');
    expect(usage.allowance).toBe(3);
  });
});

describe('getCompassionateUsageForSection default wiring', () => {
  it('a student with no override gets the school-config default, not a hardcoded 5', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/service', () => {
      const makeChain = (result: { data: unknown; error: null }) => ({
        select: () => makeChain(result),
        eq: () => makeChain(result),
        in: () => makeChain(result),
        order: () => makeChain(result),
        range: () => makeChain(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      });
      return {
        createServiceClient: vi.fn(() => ({
          from: (table: string) => {
            if (table === 'school_config') {
              return makeChain({
                data: {
                  default_compassionate_allowance_per_year: SCHOOL_DEFAULT,
                },
                error: null,
              });
            }
            if (table === 'section_students') {
              // Same row shape services both queries this function issues:
              // the roster+allowance select reads `.student`, the AY-wide
              // enrolments select reads `.student_id` — carrying both keeps
              // the mock honest for either query shape.
              return makeChain({
                data: [
                  {
                    id: 'enrolment-1',
                    student_id: 'student-1',
                    student: {
                      id: 'student-1',
                      urgent_compassionate_allowance: null,
                    },
                  },
                ],
                error: null,
              });
            }
            return makeChain({ data: [], error: null });
          },
        })),
      };
    });
    const { getCompassionateUsageForSection: getSectionUsage } =
      await import('@/lib/attendance/queries');
    const usage = await getSectionUsage('section-1', 'ay-1');
    expect(usage.get('enrolment-1')?.allowance).toBe(SCHOOL_DEFAULT);
    expect(usage.get('enrolment-1')?.used).toBe(0);
  });
});
