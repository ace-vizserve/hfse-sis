/**
 * The drill reads `attendance_daily` as the append-only ledger it is.
 *
 * `lib/attendance/drill.ts::loadEntryRows` used to select the table with no
 * ordering and no dedupe, so a corrected mark was listed twice and the drill
 * disagreed with the KPI card above it — measured on AY2026 (2026-09-15):
 * Absences 880 on the card against 983 rows in the sheet, Lates 392/404,
 * Excused 1,231/1,269. It also emitted the 11 cleared marks (migration 134
 * appends a NULL status rather than deleting) as blank-status rows, which
 * `AttendanceEntryRow.status` has never allowed.
 *
 * `lib/attendance/dashboard.ts` got this rule in "stop counting corrected
 * marks twice on the dashboard"; the drill did not. These are the drill's.
 *
 * Mocking shape mirrors __tests__/attendance/drill-day-type.test.ts: the fake
 * PostgREST chain treats `.order()` as a no-op, so FIXTURE ORDER stands in for
 * the `recorded_at desc, id asc` the real read now requests — what's under test
 * is the dedupe, not Postgres's sort.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: () => {},
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
    is: (col: string, val: unknown) => {
      data = data.filter((r) => r[col] === val);
      return chain;
    },
    order: () => chain,
    range: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return chain;
}

function mark(date: string, status: string | null, extra: Row = {}): Row {
  return {
    id: `${date}-${status ?? 'cleared'}-${Math.random().toString(36).slice(2)}`,
    date,
    term_id: 't1',
    section_student_id: 'ss1',
    period_id: null,
    status,
    ex_reason: null,
    ex_note: null,
    ...extra,
  };
}

// Newest row first within each date — what `recorded_at desc, id asc` returns.
const LEDGER: Row[] = [
  // 05 Jan: marked Absent, then corrected to Excused. One day, one mark: EX.
  mark('2026-01-05', 'EX', { ex_reason: 'mc' }),
  mark('2026-01-05', 'A'),
  // 06 Jan: marked Absent, then CLEARED. The day has no mark at all.
  mark('2026-01-06', null),
  mark('2026-01-06', 'A'),
  // 07 Jan: Present, never touched again.
  mark('2026-01-07', 'P'),
  // 08 Jan: Late, saved twice (a double submit, same value).
  mark('2026-01-08', 'L'),
  mark('2026-01-08', 'L'),
  // 09 Jan: still Absent — a real absence the drill must keep.
  mark('2026-01-09', 'A'),
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
            id: 'sec1',
            name: 'Respect',
            level_id: 'lvl1',
            academic_year_id: 'ay1',
          },
        ]);
      }
      if (table === 'levels') {
        return makeQueryChain([{ id: 'lvl1', code: 'P5' }]);
      }
      if (table === 'terms') {
        return makeQueryChain([
          {
            id: 't1',
            term_number: 1,
            academic_year_id: 'ay1',
            start_date: '2026-01-01',
            end_date: '2026-03-31',
          },
        ]);
      }
      if (table === 'section_students') {
        return makeQueryChain([
          {
            id: 'ss1',
            section_id: 'sec1',
            student_id: 'st1',
            enrollment_status: 'active',
          },
        ]);
      }
      if (table === 'students') {
        return makeQueryChain([
          {
            id: 'st1',
            first_name: 'Ana',
            middle_name: null,
            last_name: 'Cruz',
            student_number: 'H250001',
            urgent_compassionate_allowance: 5,
            vacation_leave_allowance_per_term: null,
          },
        ]);
      }
      if (table === 'attendance_daily') {
        return makeQueryChain([...LEDGER]);
      }
      return makeQueryChain([]);
    },
  })),
}));

import { buildAttendanceDrillRows } from '@/lib/attendance/drill';
import type {
  AttendanceEntryRow,
  TopAbsentDrillRow,
} from '@/lib/attendance/drill';

const drill = (target: string) =>
  buildAttendanceDrillRows({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: target as any,
    ayCode: 'AY2026',
  });

describe('attendance drill — superseded and cleared marks', () => {
  it('lists one row per day, not one per ledger row', async () => {
    const rows = (await drill('attendance-summary')) as AttendanceEntryRow[];
    // 8 ledger rows over 5 days; 06 Jan was cleared, so 4 marks survive.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.attendanceDate).sort()).toEqual([
      '2026-01-05',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
    ]);
  });

  it('keeps the correction, not the mark it replaced', async () => {
    const rows = (await drill('attendance-summary')) as AttendanceEntryRow[];
    const jan5 = rows.filter((r) => r.attendanceDate === '2026-01-05');
    expect(jan5).toHaveLength(1);
    expect(jan5[0]!.status).toBe('EX');
    expect(jan5[0]!.exReason).toBe('mc');
  });

  it('drops a day whose mark was cleared, rather than falling back to the mark underneath', async () => {
    const rows = (await drill('attendance-summary')) as AttendanceEntryRow[];
    expect(rows.some((r) => r.attendanceDate === '2026-01-06')).toBe(false);
    expect(rows.every((r) => r.status != null)).toBe(true);
  });

  it('counts the absence the card counts — once', async () => {
    // Card side: one A (09 Jan). The 05 Jan A was corrected away and the
    // 06 Jan A was cleared.
    const absent = (await drill('absent')) as AttendanceEntryRow[];
    expect(absent).toHaveLength(1);
    expect(absent[0]!.attendanceDate).toBe('2026-01-09');
  });

  it('counts a double-saved late once', async () => {
    const lates = (await drill('lates')) as AttendanceEntryRow[];
    expect(lates).toHaveLength(1);
    expect(lates[0]!.attendanceDate).toBe('2026-01-08');
  });

  it('counts the excused mark the correction created', async () => {
    const excused = (await drill('excused')) as AttendanceEntryRow[];
    expect(excused).toHaveLength(1);
    expect(excused[0]!.attendanceDate).toBe('2026-01-05');
  });

  it('does not inflate a student rollup with dead history', async () => {
    const ranked = (await drill('top-absent')) as TopAbsentDrillRow[];
    expect(ranked).toHaveLength(1);
    // 4 surviving marks: EX, P, L, A → 1 absence over 4 encoded days.
    expect(ranked[0]!.absences).toBe(1);
    expect(ranked[0]!.encodedDays).toBe(4);
    expect(ranked[0]!.attendancePct).toBe(75);
  });
});
