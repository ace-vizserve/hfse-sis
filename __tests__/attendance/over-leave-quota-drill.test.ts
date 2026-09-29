/**
 * "Over their leave quota" on Attendance Insights counts compassionate-over
 * plus vacation-over (a student over both counts twice). Its drill must list
 * exactly those rows — one per student per leave type — and the compassionate
 * list's "See all" (segment `compassionate`) exactly that list.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('no database in this test');
  },
}));

import {
  applyTargetFilter,
  defaultColumnsForTarget,
  rowKindForTarget,
  selectOverLeaveQuota,
  summariseLeaveQuota,
  toLeaveQuotaRows,
  type AttendanceDrillRow,
  type CompassionateUsageRow,
  type LeaveQuotaRow,
  type VacationLeaveUsageRow,
} from '@/lib/attendance/drill';

function compassionate(
  name: string,
  used: number,
  allowance = 5
): CompassionateUsageRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `H-${name}`,
    sectionId: 'sec-1',
    sectionName: 'Respect',
    level: 'P5',
    allowance,
    used,
    remaining: allowance - used,
    isOverQuota: used > allowance,
  };
}

function vacation(
  name: string,
  usedThisTerm: number,
  allowance = 1
): VacationLeaveUsageRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `H-${name}`,
    sectionId: 'sec-1',
    sectionName: 'Respect',
    level: 'P5',
    termId: 'term-2',
    termNumber: 2,
    allowance,
    usedThisTerm,
    remainingThisTerm: Math.max(0, allowance - usedThisTerm),
    isOverTermQuota: usedThisTerm > allowance,
  };
}

const compassionateRows = [
  compassionate('Ana', 0),
  compassionate('Ben', 6), // over
  compassionate('Cleo', 5), // at the limit, not over
  compassionate('Dina', 8), // over
];
const vacationRows = [
  vacation('Ana', 0),
  vacation('Ben', 2), // over — Ben is over BOTH allowances
  vacation('Cleo', 1), // at the limit
  vacation('Eli', 3), // over
];

// The KPI exactly as the Insights page computed it before this phase.
const kpi =
  compassionateRows.filter((r) => r.isOverQuota).length +
  vacationRows.filter((r) => r.isOverTermQuota).length;

const drill = (segment: string | null) =>
  applyTargetFilter(
    toLeaveQuotaRows(compassionateRows, vacationRows) as AttendanceDrillRow[],
    'over-leave-quota',
    segment
  ) as LeaveQuotaRow[];

describe('over-leave-quota drill', () => {
  it('lists as many rows as the KPI counts', () => {
    expect(kpi).toBe(4);
    expect(drill(null)).toHaveLength(kpi);
  });

  it('lists a student over both allowances once per leave type', () => {
    const ben = drill(null).filter((r) => r.studentName === 'Ben');
    expect(ben.map((r) => r.leaveType).sort()).toEqual([
      'compassionate',
      'vacation',
    ]);
  });

  it('never lists someone at, but not over, their allowance', () => {
    expect(drill(null).some((r) => r.studentName === 'Cleo')).toBe(false);
  });

  it('segment compassionate = the compassionate "Over quota" list', () => {
    const rows = drill('compassionate');
    expect(rows.map((r) => r.studentName).sort()).toEqual(
      compassionateRows
        .filter((r) => r.isOverQuota)
        .map((r) => r.studentName)
        .sort()
    );
  });

  it('segment vacation = the vacation over-quota students', () => {
    expect(
      drill('vacation')
        .map((r) => r.studentName)
        .sort()
    ).toEqual(['Ben', 'Eli']);
  });

  it('is the same selection selectOverLeaveQuota makes', () => {
    expect(drill(null)).toEqual(
      selectOverLeaveQuota(toLeaveQuotaRows(compassionateRows, vacationRows))
    );
  });

  it('carries the term for vacation and none for the per-year compassionate allowance', () => {
    const rows = drill(null);
    expect(rows.find((r) => r.leaveType === 'vacation')!.termNumber).toBe(2);
    expect(
      rows.find((r) => r.leaveType === 'compassionate')!.termNumber
    ).toBeNull();
  });

  it('is an empty list, not an error, when nobody is over', () => {
    expect(
      applyTargetFilter(
        toLeaveQuotaRows(
          [compassionate('Ana', 1)],
          [vacation('Ana', 1)]
        ) as AttendanceDrillRow[],
        'over-leave-quota',
        null
      )
    ).toEqual([]);
  });

  it('uses its own row kind and shows a Leave type column', () => {
    expect(rowKindForTarget('over-leave-quota')).toBe('leave-quota');
    expect(defaultColumnsForTarget('over-leave-quota')).toEqual([
      'studentName',
      'sectionName',
      'level',
      'leaveType',
      'termNumber',
      'allowance',
      'used',
    ]);
  });
});

describe('summariseLeaveQuota — the Insights quota lists', () => {
  const summary = summariseLeaveQuota(compassionateRows, vacationRows);

  it('KPI = over-leave-quota drill rows', () => {
    expect(summary.overLeaveQuotaCount).toBe(drill(null).length);
    expect(summary.overLeaveQuotaCount).toBe(
      summary.compassionateOver.length + summary.vacationOver.length
    );
  });

  it('compassionate list = the compassionate "See all" rows', () => {
    const ids = (rows: Array<{ studentSectionId: string }>) =>
      rows.map((r) => r.studentSectionId).sort();
    expect(ids(summary.compassionateOver)).toEqual(ids(drill('compassionate')));
  });

  it('vacation list = the vacation "See all" rows (over quota only)', () => {
    const ids = (rows: Array<{ studentSectionId: string }>) =>
      rows.map((r) => r.studentSectionId).sort();
    const seeAll = applyTargetFilter(
      toLeaveQuotaRows([], vacationRows) as AttendanceDrillRow[],
      'over-leave-quota',
      'vacation'
    ) as Array<{ studentSectionId: string }>;
    expect(ids(summary.vacationOver)).toEqual(ids(seeAll));
    expect(summary.vacationOver.every((r) => r.isOverTermQuota)).toBe(true);
  });

  it('does not list a student who has only used their allowance', () => {
    const s = summariseLeaveQuota([], [vacation('Cleo', 1)]);
    expect(s.vacationOver).toEqual([]);
    expect(s.haveQuotaRisk).toBe(false);
  });

  it('flags risk only when someone is over a quota', () => {
    expect(summary.haveQuotaRisk).toBe(true);
    expect(summariseLeaveQuota([], [vacation('Zed', 0, 0)]).haveQuotaRisk).toBe(
      false
    );
    expect(summariseLeaveQuota([], [vacation('Max', 2)]).haveQuotaRisk).toBe(
      true
    );
  });
});
