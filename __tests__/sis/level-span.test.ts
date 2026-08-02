/**
 * Level codes rendered as a span, for the Subject Setup "Used by" column.
 *
 * A subject taught everywhere produces ten codes. "P1–P6, S1–S4" is the same
 * fact in a quarter of the width — and the GAPS are the informative part, so
 * the collapse must never invent contiguity that isn't there.
 */

import { describe, it, expect } from 'vitest';
import {
  compareLevelCodes,
  formatLevelSpan,
} from '@/lib/sis/subjects/level-span';

describe('formatLevelSpan', () => {
  it('collapses a full primary run', () => {
    expect(formatLevelSpan(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'])).toBe('P1–P6');
  });

  it('keeps primary and secondary as separate spans', () => {
    // Real English/Maths/Science shape in AY2026.
    expect(
      formatLevelSpan([
        'P1',
        'P2',
        'P3',
        'P4',
        'P5',
        'P6',
        'S1',
        'S2',
        'S3',
        'S4',
      ])
    ).toBe('P1–P6, S1–S4');
  });

  it('never bridges a gap', () => {
    // A subject skipping P3 must not read as "P1–P4". The gap is the point.
    expect(formatLevelSpan(['P1', 'P2', 'P4', 'P5', 'P6'])).toBe(
      'P1, P2, P4–P6'
    );
  });

  it('lists a two-level run rather than hyphenating it', () => {
    // "P4, P5" is no longer than "P4–P5" and reads more plainly.
    expect(formatLevelSpan(['P4', 'P5'])).toBe('P4, P5');
  });

  it('handles a single level', () => {
    expect(formatLevelSpan(['P1'])).toBe('P1');
  });

  it('sorts numerically, not lexically', () => {
    // Lexical order would put P10 between P1 and P2.
    expect(formatLevelSpan(['P10', 'P2', 'P1'])).toBe('P1, P2, P10');
  });

  it('ignores input order and duplicates', () => {
    expect(formatLevelSpan(['S2', 'P1', 'S1', 'P1'])).toBe('P1, S1, S2');
  });

  it('returns an empty string for no levels', () => {
    expect(formatLevelSpan([])).toBe('');
    expect(formatLevelSpan(['', '  '])).toBe('');
  });

  it('keeps an unrecognised code visible rather than dropping it', () => {
    // A future level naming scheme must degrade to "still shown", never to
    // "silently missing" — this cell is a blast-radius indicator.
    const out = formatLevelSpan(['P1', 'PRESCHOOL']);
    expect(out).toContain('P1');
    expect(out).toContain('PRESCHOOL');
  });
});

describe('compareLevelCodes', () => {
  it('puts primary before secondary', () => {
    expect(compareLevelCodes('P6', 'S1')).toBeLessThan(0);
  });

  it('orders within a level type by number', () => {
    expect(compareLevelCodes('P2', 'P10')).toBeLessThan(0);
  });

  it('sorts a mixed list into school order', () => {
    const sorted = ['S1', 'P3', 'S4', 'P1'].sort(compareLevelCodes);
    expect(sorted).toEqual(['P1', 'P3', 'S1', 'S4']);
  });
});
