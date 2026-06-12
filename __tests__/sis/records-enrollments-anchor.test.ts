import { describe, expect, it } from 'vitest';

import { applyTargetFilter, type RecordsDrillRow } from '@/lib/sis/drill';

// "New enrollments" anchors on the admissions APPLICATION date
// (applicationDate = app.created_at), filtered to the currently-enrolled
// roster — mirroring Admissions "Enrolled (range)". NOT
// section_students.enrollment_date (class-start), which mis-buckets a late
// enrollee at their joining term. The Records KPI count + velocity chart both
// re-use applyTargetFilter('enrollments-range'), so this pure test is the
// structural guarantee that count == chart == drill (KD #82/#124).

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Doe, Jane',
    enrollmentStatus: 'active',
    applicationStatus: 'Enrolled',
    level: 'Primary 1',
    sectionId: 'sec1',
    sectionName: 'Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
    ...over,
  };
}

const RANGE = { from: '2026-01-01', to: '2026-03-31' }; // ~Term 1 window

describe("applyTargetFilter('enrollments-range') — admissions-application anchor", () => {
  it('includes a late enrollee who APPLIED in range even though class-start is out of range', () => {
    // The reported bug: enrolled/applied in Jan (T1 window) but starts class
    // in T3 (enrollment_date Sept). Must still count as a T1-window enrollment.
    const lateEnrollee = row({
      enrollmentStatus: 'late_enrollee',
      applicationDate: '2026-02-10', // in range
      enrollmentDate: '2026-09-01', // class-start, OUT of range
    });
    const out = applyTargetFilter(
      [lateEnrollee],
      'enrollments-range',
      null,
      RANGE
    );
    expect(out).toHaveLength(1);
  });

  it('excludes a row whose application date is OUT of range (even if class-start is in range)', () => {
    const r = row({
      applicationDate: '2025-12-15', // out of range
      enrollmentDate: '2026-02-01', // class-start in range — must NOT rescue it
    });
    expect(
      applyTargetFilter([r], 'enrollments-range', null, RANGE)
    ).toHaveLength(0);
  });

  it('drops rows with no resolvable application date', () => {
    const r = row({ applicationDate: null, enrollmentDate: '2026-02-01' });
    expect(
      applyTargetFilter([r], 'enrollments-range', null, RANGE)
    ).toHaveLength(0);
  });

  it('excludes non-enrolled-roster rows (e.g. withdrawn) even if applied in range', () => {
    const withdrawn = row({
      enrollmentStatus: 'withdrawn',
      applicationDate: '2026-02-10',
    });
    expect(
      applyTargetFilter([withdrawn], 'enrollments-range', null, RANGE)
    ).toHaveLength(0);
  });

  it('counts late_enrollee rows as a subset of the same window (matches the card subtext)', () => {
    const rows = [
      row({ applicationDate: '2026-02-01' }), // active, in range
      row({
        enrollmentStatus: 'late_enrollee',
        applicationDate: '2026-02-15',
        enrollmentDate: '2026-09-01',
      }),
    ];
    const win = applyTargetFilter(rows, 'enrollments-range', null, RANGE);
    expect(win).toHaveLength(2); // headline count
    expect(
      win.filter((r) => r.enrollmentStatus === 'late_enrollee')
    ).toHaveLength(1); // subtext
  });

  it('with no range, returns the whole enrolled roster (drops only by status)', () => {
    const rows = [
      row({ applicationDate: null }), // still enrolled — kept when no range
      row({ enrollmentStatus: 'withdrawn', applicationDate: '2026-02-01' }),
    ];
    const out = applyTargetFilter(rows, 'enrollments-range', null);
    expect(out).toHaveLength(1);
    expect(out[0].enrollmentStatus).toBe('active');
  });
});

describe("applyTargetFilter('withdrawals-range') — genuine leavers, Records signal", () => {
  it('includes a genuine leaver even when admissions status cascaded to Withdrawn (the SOFT_CLOSED regression)', () => {
    const leaver = row({
      studentNumber: 'S1',
      enrollmentStatus: 'withdrawn',
      applicationStatus: 'Withdrawn', // cascaded — previously dropped by SOFT_CLOSED
      withdrawalDate: '2026-02-10',
    });
    const out = applyTargetFilter([leaver], 'withdrawals-range', null, RANGE);
    expect(out).toHaveLength(1);
  });

  it('excludes a transfer artifact (withdrawn source row whose student is still active elsewhere)', () => {
    const rows = [
      row({
        studentNumber: 'S1',
        enrollmentStatus: 'withdrawn',
        withdrawalDate: '2026-02-10',
        sectionName: 'Old',
      }),
      row({
        studentNumber: 'S1',
        enrollmentStatus: 'active',
        sectionName: 'New',
      }),
    ];
    expect(
      applyTargetFilter(rows, 'withdrawals-range', null, RANGE)
    ).toHaveLength(0);
  });

  it('dedups a transfer-then-leave student to ONE row at the latest withdrawal_date', () => {
    const rows = [
      row({
        studentNumber: 'S1',
        enrollmentStatus: 'withdrawn',
        withdrawalDate: '2026-01-20', // transfer artifact (earlier)
      }),
      row({
        studentNumber: 'S1',
        enrollmentStatus: 'withdrawn',
        withdrawalDate: '2026-03-05', // the real leave (latest)
      }),
    ];
    const out = applyTargetFilter(rows, 'withdrawals-range', null, RANGE);
    expect(out).toHaveLength(1);
    expect(out[0].withdrawalDate).toBe('2026-03-05');
  });

  it('counts two distinct leavers separately', () => {
    const rows = [
      row({
        studentNumber: 'S1',
        enrollmentStatus: 'withdrawn',
        withdrawalDate: '2026-02-01',
      }),
      row({
        studentNumber: 'S2',
        enrollmentStatus: 'withdrawn',
        withdrawalDate: '2026-02-02',
      }),
    ];
    expect(
      applyTargetFilter(rows, 'withdrawals-range', null, RANGE)
    ).toHaveLength(2);
  });
});

describe('SOFT_CLOSED is preserved per-target (admissions-cancelled active row)', () => {
  it('excludes an active row whose admissions applicationStatus is Cancelled from enrollments-range and active-enrolled', () => {
    const cancelledActive = row({
      studentNumber: 'S9',
      enrollmentStatus: 'active',
      applicationStatus: 'Cancelled',
      applicationDate: '2026-02-01', // in range
    });
    expect(
      applyTargetFilter([cancelledActive], 'enrollments-range', null, RANGE)
    ).toHaveLength(0);
    expect(
      applyTargetFilter([cancelledActive], 'active-enrolled', null)
    ).toHaveLength(0);
  });
});
