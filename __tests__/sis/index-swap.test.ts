import { describe, expect, it } from 'vitest';

import {
  applySwap,
  validateSwap,
  type SwapCandidate,
} from '@/lib/sis/index-swap';

const SECTION = 'sec-1';

function candidate(over: Partial<SwapCandidate> = {}): SwapCandidate {
  return {
    enrolmentId: 'e-1',
    sectionId: SECTION,
    indexNumber: 1,
    enrollmentStatus: 'active',
    studentName: 'Cruz, Ana',
    ...over,
  };
}

describe('validateSwap', () => {
  it('accepts two numbered, non-withdrawn students in the same section', () => {
    const a = candidate({ enrolmentId: 'e-1', indexNumber: 3 });
    const b = candidate({
      enrolmentId: 'e-2',
      indexNumber: 4,
      studentName: 'Dizon, Ben',
    });
    const result = validateSwap(SECTION, a, b);
    expect(result.ok).toBe(true);
  });

  it('accepts a late enrollee — "late" is when they joined, not whether they are on the roster', () => {
    const a = candidate({ enrolmentId: 'e-1', indexNumber: 3 });
    const b = candidate({
      enrolmentId: 'e-2',
      indexNumber: 28,
      enrollmentStatus: 'late_enrollee',
      studentName: 'Reyes, Mia',
    });
    expect(validateSwap(SECTION, a, b).ok).toBe(true);
  });

  it('rejects the same student twice', () => {
    const a = candidate({ enrolmentId: 'e-1' });
    const result = validateSwap(SECTION, a, { ...a });
    expect(result).toMatchObject({ ok: false, reason: 'same_student' });
  });

  it('rejects a missing row on either side', () => {
    const a = candidate();
    expect(validateSwap(SECTION, a, null)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(validateSwap(SECTION, null, a)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('rejects a row belonging to another section, and names that student', () => {
    const a = candidate({ enrolmentId: 'e-1' });
    const b = candidate({
      enrolmentId: 'e-2',
      sectionId: 'sec-2',
      studentName: 'Tan, Wei',
    });
    const result = validateSwap(SECTION, a, b);
    expect(result).toMatchObject({ ok: false, reason: 'wrong_section' });
    if (!result.ok) expect(result.message).toContain('Tan, Wei');
  });

  it('rejects a withdrawn student — a retired number must never re-enter circulation', () => {
    const a = candidate({ enrolmentId: 'e-1' });
    const b = candidate({
      enrolmentId: 'e-2',
      enrollmentStatus: 'withdrawn',
      indexNumber: 12,
      studentName: 'Lim, Jo',
    });
    const result = validateSwap(SECTION, a, b);
    expect(result).toMatchObject({ ok: false, reason: 'withdrawn' });
    if (!result.ok) expect(result.message).toContain('Lim, Jo');
  });

  it('rejects an unnumbered student and points at Generate index', () => {
    const a = candidate({ enrolmentId: 'e-1' });
    const b = candidate({
      enrolmentId: 'e-2',
      indexNumber: null,
      studentName: 'Ong, Sam',
    });
    const result = validateSwap(SECTION, a, b);
    expect(result).toMatchObject({ ok: false, reason: 'unnumbered' });
    if (!result.ok) expect(result.message).toContain('Generate index');
  });

  it('reports the wrong section before the withdrawn rule when a row is both', () => {
    // A stray row is the more fundamental mismatch — telling someone a number
    // is retired in a class the student is not even in would mislead.
    const a = candidate({ enrolmentId: 'e-1' });
    const b = candidate({
      enrolmentId: 'e-2',
      sectionId: 'sec-2',
      enrollmentStatus: 'withdrawn',
    });
    expect(validateSwap(SECTION, a, b)).toMatchObject({
      ok: false,
      reason: 'wrong_section',
    });
  });
});

describe('applySwap', () => {
  const roster = [
    { enrolmentId: 'e-1', indexNumber: 1 },
    { enrolmentId: 'e-2', indexNumber: 2 },
    { enrolmentId: 'e-3', indexNumber: 3 },
  ];

  it('exchanges the two numbers and leaves everyone else alone', () => {
    const next = applySwap(roster, 'e-1', 'e-3');
    expect(next).toEqual([
      { enrolmentId: 'e-1', indexNumber: 3 },
      { enrolmentId: 'e-2', indexNumber: 2 },
      { enrolmentId: 'e-3', indexNumber: 1 },
    ]);
  });

  it('is a permutation — the multiset of numbers is unchanged', () => {
    const before = roster.map((r) => r.indexNumber).sort();
    const after = applySwap(roster, 'e-1', 'e-2')
      .map((r) => r.indexNumber)
      .sort();
    expect(after).toEqual(before);
  });

  it('opens no gap and creates no duplicate', () => {
    const next = applySwap(roster, 'e-2', 'e-3');
    const numbers = next.map((r) => r.indexNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort()).toEqual([1, 2, 3]);
  });

  it('is its own inverse — swapping the same pair twice restores the roster', () => {
    const next = applySwap(applySwap(roster, 'e-1', 'e-3'), 'e-1', 'e-3');
    expect(next).toEqual(roster);
  });

  it('does not mutate the input', () => {
    applySwap(roster, 'e-1', 'e-2');
    expect(roster[0].indexNumber).toBe(1);
  });
});
