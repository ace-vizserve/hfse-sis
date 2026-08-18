import { describe, expect, it } from 'vitest';
import { computeMasterfileOverview } from '@/lib/markbook/masterfile-dashboard';
import type { MasterfileStudentRow } from '@/lib/markbook/masterfile';

function row(p: Partial<MasterfileStudentRow>): MasterfileStudentRow {
  return {
    studentId: 'x',
    studentNumber: 'S',
    fullName: 'N',
    sectionId: 'sec',
    sectionName: 'Grit',
    formClassAdviser: null,
    enrollmentStatus: 'active',
    indexNumber: 1,
    lateEnrolleeTermNumber: null,
    subjectRows: [],
    generalAverage: null,
    overallAward: null,
    attendanceByTerm: [],
    attendanceTotal: { present: 0, late: 0, excused: 0, schoolDays: 0 },
    commentsByTerm: [],
    enrolledTermNumbers: [1, 2, 3, 4],
    ...p,
  };
}

describe('computeMasterfileOverview', () => {
  it('counts by status and breaks late down by term', () => {
    const rows = [
      row({ enrollmentStatus: 'active' }),
      row({ enrollmentStatus: 'withdrawn' }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 2 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 2 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: 3 }),
      row({ enrollmentStatus: 'late_enrollee', lateEnrolleeTermNumber: null }),
    ];
    const o = computeMasterfileOverview(rows);
    expect(o.total).toBe(6);
    expect(o.active).toBe(1);
    expect(o.withdrawn).toBe(1);
    // lateEnrollee is the TOTAL of late enrollees (4) — the headline count.
    expect(o.lateEnrollee).toBe(4);
    // lateByTerm breaks down only the resolved ones; lateUnresolved holds the
    // rest. sum(lateByTerm) + lateUnresolved === lateEnrollee.
    expect(o.lateByTerm).toEqual([
      { termNumber: 2, count: 2 },
      { termNumber: 3, count: 1 },
    ]);
    expect(o.lateUnresolved).toBe(1);
    expect(
      o.lateByTerm.reduce((s, b) => s + b.count, 0) + o.lateUnresolved
    ).toBe(o.lateEnrollee);
  });
});
