import { describe, expect, it } from 'vitest';

import { parseScore } from '@/lib/house-points/parse-score';

// The score sheet's one text → number rule. Blank is not zero: an empty box is
// "no score yet" (no placement, no points), while "0" is a real score that is
// ranked like any other.

describe('parseScore', () => {
  it('reads a blank box as no score yet, not zero', () => {
    expect(parseScore('', 50)).toEqual({ value: null, error: null });
    expect(parseScore('   ', 50)).toEqual({ value: null, error: null });
  });

  it('reads "0" as a real score of zero', () => {
    expect(parseScore('0', 50)).toEqual({ value: 0, error: null });
  });

  it('reads whole and decimal scores', () => {
    expect(parseScore('46', 50)).toEqual({ value: 46, error: null });
    expect(parseScore(' 12.5 ', 50)).toEqual({ value: 12.5, error: null });
  });

  it('accepts the highest possible score itself', () => {
    expect(parseScore('50', 50)).toEqual({ value: 50, error: null });
  });

  it('refuses a score above the highest possible score', () => {
    const result = parseScore('51', 50);
    expect(result.value).toBeNull();
    expect(result.error).toBe("Score can't be more than 50.");
  });

  it('refuses something that is not a number', () => {
    const result = parseScore('abc', 50);
    expect(result.value).toBeNull();
    expect(result.error).toBe('Enter a number, or leave it blank.');
  });

  it('refuses a negative score', () => {
    const result = parseScore('-3', 50);
    expect(result.value).toBeNull();
    expect(result.error).toBe("Score can't be negative.");
  });
});
