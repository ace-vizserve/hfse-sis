/**
 * Regression test for `getCompassionateOverQuota` (lib/attendance/drill.ts)
 * — the fast, narrow query added so the attendance PriorityPanel + hero lede
 * don't have to wait on the ~180k-row `buildAllRowSets` scan (granular
 * Suspense streaming, Task 2).
 *
 * The highest-risk part of this change is the KD #67 transfer-union rule:
 * `getCompassionateOverQuota` queries `attendance_daily` directly instead of
 * rolling up from a full scan, so it must still union a student's usage
 * across their withdrawn pre-transfer `section_students` row AND their
 * active post-transfer row — never double-count, never drop either side.
 *
 * This test builds a transfer fixture and asserts `getCompassionateOverQuota`
 * produces the SAME over-quota verdict as `rollupCompassionate` (exercised
 * here via the public `compassionate-quota` drill target) for the same
 * student. Mocking shape mirrors __tests__/attendance/drill-day-type.test.ts.
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
    order: () => chain,
    range: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

// Transfer scenario: stu1 has a withdrawn pre-transfer row (ss-old) and an
// active post-transfer row (ss-new) — the KD #67 shape. stu2 never
// transferred and stays comfortably under quota (control).
const SECTION_STUDENTS: Row[] = [
  {
    id: 'ss-old',
    section_id: 'sec-old',
    student_id: 'stu1',
    enrollment_status: 'withdrawn',
  },
  {
    id: 'ss-new',
    section_id: 'sec-new',
    student_id: 'stu1',
    enrollment_status: 'active',
  },
  {
    id: 'ss-2',
    section_id: 'sec-new',
    student_id: 'stu2',
    enrollment_status: 'active',
  },
];

const STUDENTS: Row[] = [
  {
    id: 'stu1',
    first_name: 'Ana',
    middle_name: null,
    last_name: 'Cruz',
    student_number: 'S001',
    urgent_compassionate_allowance: 5,
    vacation_leave_allowance_per_term: 1,
  },
  {
    id: 'stu2',
    first_name: 'Ben',
    middle_name: null,
    last_name: 'Diaz',
    student_number: 'S002',
    urgent_compassionate_allowance: 5,
    vacation_leave_allowance_per_term: 1,
  },
];

// stu1: 3 compassionate EX on the withdrawn pre-transfer row + 3 more on the
// active post-transfer row = 6 used against an allowance of 5 → over quota,
// but only if BOTH rows are unioned. stu2: 2 used, well under allowance.
// Decoys: a non-compassionate EX, a non-EX status, and a vacation EX — none
// of these should ever be counted as compassionate usage.
const ATTENDANCE_ROWS: Row[] = [
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `ex-old-${i}`,
    date: `2026-01-0${i + 1}`,
    term_id: 't1',
    section_student_id: 'ss-old',
    status: 'EX',
    ex_reason: 'compassionate',
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `ex-new-${i}`,
    date: `2026-02-0${i + 1}`,
    term_id: 't1',
    section_student_id: 'ss-new',
    status: 'EX',
    ex_reason: 'compassionate',
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `ex-2-${i}`,
    date: `2026-01-1${i}`,
    term_id: 't1',
    section_student_id: 'ss-2',
    status: 'EX',
    ex_reason: 'compassionate',
  })),
  {
    id: 'decoy-mc',
    date: '2026-01-15',
    term_id: 't1',
    section_student_id: 'ss-old',
    status: 'EX',
    ex_reason: 'mc',
  },
  {
    id: 'decoy-present',
    date: '2026-01-16',
    term_id: 't1',
    section_student_id: 'ss-new',
    status: 'P',
    ex_reason: null,
  },
  {
    id: 'decoy-vacation',
    date: '2026-01-17',
    term_id: 't1',
    section_student_id: 'ss-2',
    status: 'EX',
    ex_reason: 'vacation',
  },
];

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'academic_years') {
        return makeQueryChain([{ id: 'ay1', ay_code: 'AY2026' }]);
      }
      if (table === 'sections') {
        return makeQueryChain([
          {
            id: 'sec-old',
            name: 'Old Section',
            level_id: 'lvl1',
            academic_year_id: 'ay1',
          },
          {
            id: 'sec-new',
            name: 'New Section',
            level_id: 'lvl1',
            academic_year_id: 'ay1',
          },
        ]);
      }
      if (table === 'levels') {
        return makeQueryChain([{ id: 'lvl1', code: 'P1' }]);
      }
      if (table === 'terms') {
        return makeQueryChain([
          { id: 't1', term_number: 1, academic_year_id: 'ay1' },
        ]);
      }
      if (table === 'section_students') {
        return makeQueryChain([...SECTION_STUDENTS]);
      }
      if (table === 'students') {
        return makeQueryChain([...STUDENTS]);
      }
      if (table === 'attendance_daily') {
        return makeQueryChain([...ATTENDANCE_ROWS]);
      }
      return makeQueryChain([]);
    },
  })),
}));

import {
  buildAttendanceDrillRows,
  getCompassionateOverQuota,
} from '@/lib/attendance/drill';
import type { CompassionateUsageRow } from '@/lib/attendance/drill';

describe('getCompassionateOverQuota — KD #67 transfer union', () => {
  it('unions usage across a withdrawn pre-transfer row and the active post-transfer row', async () => {
    const rows = await getCompassionateOverQuota('AY2026');

    expect(rows).toHaveLength(1);
    expect(rows[0].studentNumber).toBe('S001');
    expect(rows[0].used).toBe(6);
    expect(rows[0].allowance).toBe(5);
    expect(rows[0].isOverQuota).toBe(true);
  });

  it('excludes a student comfortably under quota', async () => {
    const rows = await getCompassionateOverQuota('AY2026');
    expect(rows.some((r) => r.studentNumber === 'S002')).toBe(false);
  });

  it('never counts a non-compassionate EX or a non-EX status', async () => {
    // If the decoy rows leaked in, stu1's used count would exceed 6.
    const rows = await getCompassionateOverQuota('AY2026');
    expect(rows[0].used).toBe(6);
  });

  it('agrees with rollupCompassionate (the full-scan path) on the same student', async () => {
    const overQuotaRows = await getCompassionateOverQuota('AY2026');

    const fullScanRows = (await buildAttendanceDrillRows({
      ayCode: 'AY2026',
      target: 'compassionate-quota',
    })) as CompassionateUsageRow[];
    const fullScanOverQuota = fullScanRows.filter((r) => r.isOverQuota);

    expect(fullScanOverQuota).toHaveLength(overQuotaRows.length);
    expect(fullScanOverQuota[0].studentNumber).toBe(
      overQuotaRows[0].studentNumber
    );
    expect(fullScanOverQuota[0].used).toBe(overQuotaRows[0].used);
    expect(fullScanOverQuota[0].allowance).toBe(overQuotaRows[0].allowance);
    expect(fullScanOverQuota[0].remaining).toBe(overQuotaRows[0].remaining);
  });
});
