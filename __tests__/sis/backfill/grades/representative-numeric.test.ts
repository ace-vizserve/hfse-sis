import { describe, it, expect } from 'vitest';
import { letterToRepresentative } from '@/lib/sis/backfill/grades/representative-numeric';
import { numericToLetter } from '@/lib/compute/letter-grade';

describe('letterToRepresentative', () => {
  it('round-trips every derived letter through numericToLetter', () => {
    for (const L of ['A', 'B', 'C', 'IP'] as const) {
      const n = letterToRepresentative(L);
      expect(n).not.toBeNull();
      expect(Number.isInteger(n)).toBe(true);
      expect(numericToLetter(n as number)).toBe(L);
    }
  });
  it('is case-insensitive and returns null for unknown', () => {
    expect(letterToRepresentative('a')).toBe(letterToRepresentative('A'));
    expect(letterToRepresentative('Z')).toBeNull();
  });
});
