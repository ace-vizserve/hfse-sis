import { describe, expect, it } from 'vitest';

import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  isAttendanceAtRisk,
  selectAtRiskStudents,
} from '@/lib/classroom/health';

describe('AT_RISK_ATTENDANCE_THRESHOLD_PCT', () => {
  // Asserted explicitly so a silent change to the constant shows up as a
  // failing test, not a quiet drift in what "at risk" means (per the Phase 5
  // brief's "should be asserted somewhere" instruction).
  it('is 90', () => {
    expect(AT_RISK_ATTENDANCE_THRESHOLD_PCT).toBe(90);
  });
});

describe('isAttendanceAtRisk', () => {
  it('is false for null — no rollup recorded is "no data," never "at risk"', () => {
    expect(isAttendanceAtRisk(null)).toBe(false);
  });

  it('is false at and above the threshold', () => {
    expect(isAttendanceAtRisk(90)).toBe(false);
    expect(isAttendanceAtRisk(95)).toBe(false);
    expect(isAttendanceAtRisk(100)).toBe(false);
  });

  it('is true strictly below the threshold', () => {
    expect(isAttendanceAtRisk(89.9)).toBe(true);
    expect(isAttendanceAtRisk(0)).toBe(true);
  });
});

describe('selectAtRiskStudents', () => {
  const roster = [
    {
      sectionStudentId: 'ss-1',
      indexNumber: 1,
      studentNumber: 'S0001',
      name: 'Cruz, Ana',
    },
    {
      sectionStudentId: 'ss-2',
      indexNumber: 2,
      studentNumber: 'S0002',
      name: 'Dela Cruz, Ben',
    },
    {
      sectionStudentId: 'ss-3',
      indexNumber: 3,
      studentNumber: 'S0003',
      name: 'Reyes, Cathy',
    },
  ];

  it('excludes students at or above the threshold', () => {
    const rollups = [
      { sectionStudentId: 'ss-1', attendancePct: 95 },
      { sectionStudentId: 'ss-2', attendancePct: 90 },
      { sectionStudentId: 'ss-3', attendancePct: 100 },
    ];
    expect(selectAtRiskStudents(rollups, roster)).toEqual([]);
  });

  it('excludes null (no rollup yet) rather than treating it as at risk', () => {
    const rollups = [{ sectionStudentId: 'ss-1', attendancePct: null }];
    expect(selectAtRiskStudents(rollups, roster)).toEqual([]);
  });

  it('includes students below the threshold, sorted worst-first', () => {
    const rollups = [
      { sectionStudentId: 'ss-1', attendancePct: 85 },
      { sectionStudentId: 'ss-2', attendancePct: 60 },
      { sectionStudentId: 'ss-3', attendancePct: 100 },
    ];
    const result = selectAtRiskStudents(rollups, roster);
    expect(result.map((s) => s.sectionStudentId)).toEqual(['ss-2', 'ss-1']);
    expect(result[0]).toMatchObject({
      sectionStudentId: 'ss-2',
      name: 'Dela Cruz, Ben',
      studentNumber: 'S0002',
      indexNumber: 2,
      attendancePct: 60,
    });
  });

  it('drops a rollup row with no matching roster entry (e.g. a withdrawn student)', () => {
    const rollups = [{ sectionStudentId: 'ss-withdrawn', attendancePct: 10 }];
    expect(selectAtRiskStudents(rollups, roster)).toEqual([]);
  });
});
