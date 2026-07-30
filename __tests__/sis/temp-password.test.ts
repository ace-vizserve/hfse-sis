import { describe, it, expect } from 'vitest';

import {
  TEMP_PASSWORD_CHARSETS,
  TEMP_PASSWORD_LENGTH,
  generateDistinctTempPasswords,
  generateTempPassword,
} from '../../lib/sis/provisioning/temp-password';

const { upper, lower, digit, symbol } = TEMP_PASSWORD_CHARSETS;
const ALL = upper + lower + digit + symbol;

// Enough samples that a per-character class bug shows up reliably.
const SAMPLES = 500;
const sample = () =>
  Array.from({ length: SAMPLES }, () => generateTempPassword());

describe('generateTempPassword', () => {
  it('is exactly TEMP_PASSWORD_LENGTH characters', () => {
    expect(TEMP_PASSWORD_LENGTH).toBe(8);
    for (const p of sample()) {
      expect(p).toHaveLength(TEMP_PASSWORD_LENGTH);
    }
  });

  it('clears the 8-char minimum enforced by InviteUserSchema', () => {
    // The provisioning script parses every row through InviteUserSchema,
    // which rejects passwords under 8 chars. A shorter generator would
    // fail every account rather than a few.
    expect(TEMP_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('uses only characters from the curated charsets', () => {
    for (const p of sample()) {
      for (const ch of p) {
        expect(ALL).toContain(ch);
      }
    }
  });

  it('never emits visually-confusable glyphs', () => {
    // 0/O and 1/l/I are the pairs a person misreads off a printed handout.
    for (const p of sample()) {
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  it('never emits a shell metacharacter', () => {
    // A password pasted into a terminal must not need quoting.
    for (const p of sample()) {
      expect(p).not.toMatch(/[$&*`'"\\|;<>()]/);
    }
  });

  it('guarantees at least one upper, lower, digit and symbol', () => {
    for (const p of sample()) {
      expect([...p].some((c) => upper.includes(c))).toBe(true);
      expect([...p].some((c) => lower.includes(c))).toBe(true);
      expect([...p].some((c) => digit.includes(c))).toBe(true);
      expect([...p].some((c) => symbol.includes(c))).toBe(true);
    }
  });

  it('does not anchor character classes to fixed positions', () => {
    // Pre-shuffle the first four characters are upper/lower/digit/symbol in
    // order. If the shuffle regressed, position 0 would always be uppercase.
    const firstChars = sample().map((p) => p[0]!);
    expect(firstChars.some((c) => !upper.includes(c))).toBe(true);
  });

  it('produces varied output', () => {
    const set = new Set(sample());
    // 500 draws from a ~66^8 space should collide essentially never; a
    // constant or low-entropy generator would collapse this hard.
    expect(set.size).toBeGreaterThan(SAMPLES * 0.99);
  });
});

describe('generateDistinctTempPasswords', () => {
  it('returns exactly n distinct passwords', () => {
    const out = generateDistinctTempPasswords(12);
    expect(out).toHaveLength(12);
    expect(new Set(out).size).toBe(12);
  });

  it('handles zero', () => {
    expect(generateDistinctTempPasswords(0)).toEqual([]);
  });

  it('stays distinct at a larger count', () => {
    const out = generateDistinctTempPasswords(200);
    expect(new Set(out).size).toBe(200);
  });

  it('every returned password satisfies the single-password contract', () => {
    for (const p of generateDistinctTempPasswords(50)) {
      expect(p).toHaveLength(TEMP_PASSWORD_LENGTH);
      expect([...p].every((c) => ALL.includes(c))).toBe(true);
    }
  });

  it('rejects a negative or fractional count', () => {
    expect(() => generateDistinctTempPasswords(-1)).toThrow();
    expect(() => generateDistinctTempPasswords(1.5)).toThrow();
  });
});
