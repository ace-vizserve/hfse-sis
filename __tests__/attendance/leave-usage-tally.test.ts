/**
 * Tests for tallyLeaveUsageByStudent() — the pure per-student leave-usage
 * aggregator in lib/attendance/drill.ts.
 *
 * Guards the KD #67 transfer rule: quota usage is attached to the STUDENT,
 * unioned across every section_students row in the AY — a mid-year transfer
 * leaves pre-transfer usage on the withdrawn enrolment row, and that usage
 * must still count toward the student's quota (matching
 * getCompassionateUsageForSection / getVacationLeaveUsageForSection in
 * lib/attendance/queries.ts).
 */

import { describe, it, expect } from 'vitest';
import { tallyLeaveUsageByStudent } from '@/lib/attendance/drill';

type EntryLite = {
  studentSectionId: string;
  termId: string;
  status: 'P' | 'L' | 'EX' | 'A' | 'NC';
  exReason: string | null;
};

function ex(
  studentSectionId: string,
  exReason: 'compassionate' | 'vacation',
  termId = 't1'
): EntryLite {
  return { studentSectionId, termId, status: 'EX', exReason };
}

// Transfer scenario: student stu1 has a withdrawn pre-transfer row (ss-old)
// and an active post-transfer row (ss-new). stu2 never transferred (ss-2).
const SS_TO_STUDENT = new Map<string, string>([
  ['ss-old', 'stu1'],
  ['ss-new', 'stu1'],
  ['ss-2', 'stu2'],
]);

describe('tallyLeaveUsageByStudent — transfer union (KD #67)', () => {
  it("unions usage across a student's withdrawn + active enrolment rows", () => {
    const entries = [
      ex('ss-old', 'compassionate'), // pre-transfer, on the withdrawn row
      ex('ss-old', 'compassionate'),
      ex('ss-new', 'compassionate'), // post-transfer, on the active row
    ];
    const usage = tallyLeaveUsageByStudent(
      entries,
      SS_TO_STUDENT,
      'compassionate'
    );
    expect(usage.get('stu1')).toBe(3);
    expect(usage.get('stu2')).toBeUndefined();
  });

  it('single-row common case (no transfer) is unchanged', () => {
    const entries = [ex('ss-2', 'compassionate'), ex('ss-2', 'compassionate')];
    const usage = tallyLeaveUsageByStudent(
      entries,
      SS_TO_STUDENT,
      'compassionate'
    );
    expect(usage.get('stu2')).toBe(2);
  });

  it('filters by ex_reason — vacation entries never count as compassionate', () => {
    const entries = [ex('ss-old', 'vacation'), ex('ss-new', 'compassionate')];
    const usage = tallyLeaveUsageByStudent(
      entries,
      SS_TO_STUDENT,
      'compassionate'
    );
    expect(usage.get('stu1')).toBe(1);
  });

  it('ignores non-EX statuses and unknown section_student ids', () => {
    const entries: EntryLite[] = [
      { studentSectionId: 'ss-old', termId: 't1', status: 'A', exReason: null },
      ex('ss-unknown', 'compassionate'),
    ];
    const usage = tallyLeaveUsageByStudent(
      entries,
      SS_TO_STUDENT,
      'compassionate'
    );
    expect(usage.size).toBe(0);
  });

  it('vacation with termId scopes to that term but still unions across rows', () => {
    const entries = [
      ex('ss-old', 'vacation', 't1'), // pre-transfer VL in T1
      ex('ss-new', 'vacation', 't1'), // post-transfer VL in T1
      ex('ss-new', 'vacation', 't2'), // different term — excluded
    ];
    const usage = tallyLeaveUsageByStudent(
      entries,
      SS_TO_STUDENT,
      'vacation',
      't1'
    );
    expect(usage.get('stu1')).toBe(2);
  });
});
