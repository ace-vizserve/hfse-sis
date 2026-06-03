import { describe, expect, it } from 'vitest';
import {
  resolveEnrolmentPosition,
  type TermWindow,
} from '@/lib/sis/enrolment-position';

// AY9999-shaped windows.
const TERMS: TermWindow[] = [
  { termNumber: 1, startDate: '2026-01-08', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-24', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-06' },
  { termNumber: 4, startDate: '2026-09-14', endDate: '2026-11-21' },
];

describe('resolveEnrolmentPosition', () => {
  it('mid-T1: late, can defer to T2', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-01-15');
    expect(p.activeTerm?.termNumber).toBe(1);
    expect(p.nextTerm?.termNumber).toBe(2);
    expect(p.joiningTerm?.termNumber).toBe(1);
    expect(p.yearStarted).toBe(true);
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(true);
  });

  it('mid-T3: late, defer to T4', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-07-10');
    expect(p.activeTerm?.termNumber).toBe(3);
    expect(p.nextTerm?.termNumber).toBe(4);
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(true);
  });

  it('mid-T4: late, no next term to defer to', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-10-01');
    expect(p.activeTerm?.termNumber).toBe(4);
    expect(p.nextTerm).toBeNull();
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(false);
  });

  it('break after T1 (between T2 and T3): late, joining next term T3', () => {
    // Year has started (T1 began 2026-01-08), so a join during the break is
    // still LATE — they join T3, the next term, but late for the year.
    const p = resolveEnrolmentPosition(TERMS, '2026-06-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm?.termNumber).toBe(3);
    expect(p.joiningTerm?.termNumber).toBe(3);
    expect(p.yearStarted).toBe(true);
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(false); // no active term → no current-vs-next choice
    expect(p.daysLeftInActiveTerm).toBeNull();
  });

  it('before T1: not late, joining T1 on time', () => {
    const p = resolveEnrolmentPosition(TERMS, '2025-12-20');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm?.termNumber).toBe(1);
    expect(p.yearStarted).toBe(false);
    expect(p.isLateEnrollee).toBe(false);
  });

  it('after T4: year started but no joining term → not late (out of scope)', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-12-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm).toBeNull();
    expect(p.joiningTerm).toBeNull();
    expect(p.yearStarted).toBe(true);
    expect(p.isLateEnrollee).toBe(false);
  });

  it('computes days left in the active term', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-09-06'); // T3 last day
    expect(p.activeTerm?.termNumber).toBe(3);
    expect(p.daysLeftInActiveTerm).toBe(0);
    const q = resolveEnrolmentPosition(TERMS, '2026-08-30'); // 7 days before T3 end
    expect(q.daysLeftInActiveTerm).toBe(7);
  });

  it('returns all-null for an empty term list', () => {
    const p = resolveEnrolmentPosition([], '2026-06-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm).toBeNull();
    expect(p.yearStarted).toBe(false);
    expect(p.isLateEnrollee).toBe(false);
  });
});
