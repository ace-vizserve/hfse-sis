/**
 * A drill sheet must list the rows its card's number is made of.
 *
 * Four attendance cards computed their figure by filtering the rollup in the
 * component and then handed the drill the UNFILTERED rollup. Measured on live
 * AY2026 (2026-09-15): the compassionate-leave card read "0 over / 0 near" and
 * its sheet opened with 398 rows, 397 of them zero usage; vacation leave read
 * "0 over / 2 at limit" against the same 398. `top-absent` / `top-active` are
 * the same defect with the zero hidden — the card previews 10 rows of a
 * ranking, the sheet listed every student in the year including those never
 * absent, and `top-active`'s ascending sort was unreachable dead code.
 *
 * These assert the card's own predicate against `applyTargetFilter`, so the
 * two cannot drift again. Pure — no database, no component render.
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
  selectAtRiskCompassionate,
  selectAtRiskVacationLeave,
  sortTopActive,
  TOP_ATTENDANCE_LIST_LIMIT,
  type AttendanceDrillRow,
  type CompassionateUsageRow,
  type TopAbsentDrillRow,
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
    termId: 'term-4',
    termNumber: 4,
    allowance,
    usedThisTerm,
    remainingThisTerm: allowance - usedThisTerm,
    isOverTermQuota: usedThisTerm > allowance,
  };
}

function attender(
  name: string,
  absences: number,
  encodedDays: number
): TopAbsentDrillRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `H-${name}`,
    sectionId: 'sec-1',
    sectionName: 'Respect',
    level: 'P5',
    absences,
    lates: 0,
    excused: 0,
    encodedDays,
    attendancePct:
      encodedDays > 0
        ? Math.round(((encodedDays - absences) / encodedDays) * 100)
        : 0,
  };
}

const drill = (
  rows: AttendanceDrillRow[],
  target: Parameters<typeof applyTargetFilter>[1]
) => applyTargetFilter(rows, target, null);

describe('compassionate-quota drill', () => {
  // The shape of the production bug: a roster where nobody is at risk.
  const roster = [
    compassionate('Ana', 0),
    compassionate('Ben', 0),
    compassionate('Cleo', 1),
  ];

  it('returns nothing when the card shows nothing', () => {
    expect(selectAtRiskCompassionate(roster)).toHaveLength(0);
    expect(drill(roster, 'compassionate-quota')).toHaveLength(0);
  });

  it('returns exactly the card at-risk set', () => {
    const rows = [
      ...roster,
      compassionate('Dina', 5), // remaining 0 → near
      compassionate('Eli', 7), // over quota
    ];
    expect(drill(rows, 'compassionate-quota')).toEqual(
      selectAtRiskCompassionate(rows)
    );
  });

  it('never returns a zero-usage row', () => {
    const rows = [compassionate('Ana', 0), compassionate('Eli', 7)];
    const out = drill(rows, 'compassionate-quota') as CompassionateUsageRow[];
    expect(out.every((r) => r.used > 0)).toBe(true);
  });
});

describe('vacation-leave-quota drill', () => {
  it('returns exactly the card at-risk set', () => {
    const rows = [
      vacation('Ana', 0),
      vacation('Ben', 1), // at the 1-per-term limit
      vacation('Cleo', 2), // over
    ];
    expect(drill(rows, 'vacation-leave-quota')).toEqual(
      selectAtRiskVacationLeave(rows)
    );
    expect(drill(rows, 'vacation-leave-quota')).toHaveLength(2);
  });

  it('returns nothing when nobody took vacation leave', () => {
    const rows = [vacation('Ana', 0), vacation('Ben', 0)];
    expect(drill(rows, 'vacation-leave-quota')).toHaveLength(0);
  });
});

describe('top-absent / top-active drills', () => {
  // rollupTopAbsent hands these over already sorted by absences desc.
  const ranked = [
    attender('Ana', 9, 50),
    attender('Ben', 4, 50),
    attender('Cleo', 1, 50),
    attender('Dina', 0, 50),
    attender('Eli', 0, 0), // enrolled, no marks encoded at all
  ];

  it('drops students who were never absent', () => {
    const out = drill(ranked, 'top-absent') as TopAbsentDrillRow[];
    expect(out.map((r) => r.studentName)).toEqual(['Ana', 'Ben', 'Cleo']);
  });

  it('is the card preview unsliced — the card rows are its prefix', () => {
    const out = drill(ranked, 'top-absent') as TopAbsentDrillRow[];
    const cardRows = ranked
      .filter((r) => r.absences > 0)
      .slice(0, TOP_ATTENDANCE_LIST_LIMIT);
    expect(out.slice(0, cardRows.length)).toEqual(cardRows);
  });

  it('orders top-active best-attendance-first, not most-absent-first', () => {
    const out = drill(ranked, 'top-active') as TopAbsentDrillRow[];
    // Dina (0 absences) leads; Eli has no encoded days and is excluded.
    expect(out.map((r) => r.studentName)).toEqual([
      'Dina',
      'Cleo',
      'Ben',
      'Ana',
    ]);
    expect(out).toEqual(sortTopActive(ranked.filter((r) => r.encodedDays > 0)));
  });

  it('does not return the top-absent order for top-active', () => {
    const absent = drill(ranked, 'top-absent') as TopAbsentDrillRow[];
    const active = drill(ranked, 'top-active') as TopAbsentDrillRow[];
    expect(active[0]!.studentName).not.toBe(absent[0]!.studentName);
  });
});
