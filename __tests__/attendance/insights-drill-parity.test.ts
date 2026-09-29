/**
 * Attendance Insights: the number on a card or pie slice must equal the rows
 * its drill lists. The card counts through kpisFromCounts over mark buckets;
 * the drill filters entry rows through applyTargetFilter after the same
 * date-window filter buildAttendanceDrillRows applies. Same fixture in, same
 * count out — per target, inside a term window.
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
  countsFromRows,
  kpisFromCounts,
  sliceMarkCounts,
  type DailyRow,
} from '@/lib/attendance/dashboard';
import {
  applyTargetFilter,
  type AttendanceDrillRow,
  type AttendanceEntryRow,
} from '@/lib/attendance/drill';
import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';

let seq = 0;
function entry(
  student: string,
  date: string,
  status: AttendanceEntryRow['status'],
  exReason: string | null = null
): AttendanceEntryRow {
  seq += 1;
  return {
    entryId: `e-${seq}`,
    attendanceDate: date,
    termId: date < '2026-03-20' ? 'term-1' : 'term-2',
    sectionId: 'sec-1',
    sectionName: 'Respect',
    studentSectionId: `ss-${student}`,
    studentName: student,
    studentNumber: `H-${student}`,
    level: 'P5',
    status,
    exReason,
    notes: null,
  };
}

// Already the surviving mark per (student, date) — the dedupe is shared by
// both paths and pinned by drill-supersede / dashboard-supersede tests.
const entries: AttendanceEntryRow[] = [
  entry('Ana', '2026-03-02', 'P'),
  entry('Ana', '2026-03-03', 'L'),
  entry('Ana', '2026-03-24', 'A'),
  entry('Ben', '2026-03-02', 'EX', 'mc'),
  entry('Ben', '2026-03-03', 'NC'),
  entry('Ben', '2026-03-24', 'P'),
  entry('Cleo', '2026-03-02', 'A'),
  entry('Cleo', '2026-03-03', 'P'),
  entry('Cleo', '2026-03-25', 'EX', 'vacation'),
  entry('Cleo', '2026-03-26', 'L'),
];

const asDaily: DailyRow[] = entries.map((e) => ({
  date: e.attendanceDate,
  status: e.status,
  ex_reason: e.exReason,
  section_student_id: e.studentSectionId,
}));

const TERM_1 = { from: '2026-01-05', to: '2026-03-13' };
const TERM_2 = { from: '2026-03-23', to: '2026-05-29' };

function kpisIn(window: { from: string; to: string }) {
  return kpisFromCounts(
    sliceMarkCounts(countsFromRows(asDaily), window.from, window.to)
  );
}

function drillIn(
  target: Parameters<typeof applyTargetFilter>[1],
  window: { from: string; to: string }
): AttendanceDrillRow[] {
  const scoped = applyDateRangeFilter(
    entries,
    { from: window.from, to: window.to },
    (r) => r.attendanceDate
  );
  return applyTargetFilter(scoped as AttendanceDrillRow[], target, null);
}

describe.each([
  ['Term 1', TERM_1],
  ['Term 2', TERM_2],
])('%s window', (_name, window) => {
  it('Present slice = present drill rows', () => {
    expect(drillIn('present', window)).toHaveLength(kpisIn(window).present);
  });

  it('Late card and slice = lates drill rows', () => {
    expect(drillIn('lates', window)).toHaveLength(kpisIn(window).late);
  });

  it('Excused slice = excused drill rows', () => {
    expect(drillIn('excused', window)).toHaveLength(kpisIn(window).excused);
  });

  it('Days absent card and slice = absent drill rows', () => {
    expect(drillIn('absent', window)).toHaveLength(kpisIn(window).absent);
  });

  it('Attendance rate opens its denominator — every marked day, NC excluded', () => {
    expect(drillIn('attendance-summary', window)).toHaveLength(
      kpisIn(window).encodedDays
    );
  });
});

it('present rows are only P marks', () => {
  const rows = drillIn('present', TERM_1) as AttendanceEntryRow[];
  expect(rows.map((r) => r.status)).toEqual(['P', 'P']);
});
