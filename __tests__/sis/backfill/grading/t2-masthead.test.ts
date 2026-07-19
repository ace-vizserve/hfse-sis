// __tests__/sis/backfill/grading/t2-masthead.test.ts
import { describe, expect, it } from 'vitest';

import {
  resolveIdentity,
  hasAnyScore,
  isReservedTabName,
  dedupePreferringNonReservedTab,
} from '@/lib/sis/backfill/grading/t2-masthead';

describe('resolveIdentity', () => {
  it('uses the tab name when it agrees with row 2 (no note of any kind)', () => {
    const result = resolveIdentity(
      'Math - P1 Patience',
      'Primary 1 PATIENCE - MATH'
    );
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P1',
      sectionName: 'Patience',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toBeNull();
  });

  it('falls back to row 2 when the tab name does not parse at all (Reserved-tab case)', () => {
    const result = resolveIdentity('Reserved 1', 'Primary 1 RESPECT - MATH');
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P1',
      sectionName: 'Respect',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toBeNull();
  });

  it('prefers the tab name over a wrong row-2 label, logging a correction note (Phase 6a real case)', () => {
    const result = resolveIdentity(
      'English - P5 Perseverance',
      'Primary 5 COMMITMENT - ENGLISH'
    );
    expect(result.identity).toEqual({
      kind: 'primary',
      levelCode: 'P5',
      sectionName: 'Perseverance',
    });
    expect(result.correctionNote).toContain('English - P5 Perseverance');
    expect(result.correctionNote).toContain('P5 Perseverance');
    expect(result.correctionNote).toContain('P5 Commitment');
    expect(result.truncationNote).toBeNull();
  });

  it('prefers row 2 over a TRUNCATED tab name, logging a distinct truncation note — the real SS & Geo case', () => {
    // Real tab name: "Social Studies&Geography - S3 C" (31 chars, Excel's
    // limit) — really "...S3 Consistency", cut off.
    const result = resolveIdentity(
      'Social Studies&Geography - S3 C',
      'Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S3',
      sectionName: 'Consistency',
    });
    expect(result.correctionNote).toBeNull();
    expect(result.truncationNote).toContain('Social Studies&Geography - S3 C');
    expect(result.truncationNote).toContain('Consistency');
  });

  it('prefers row 2 over a truncated tab name — the real Contemporary Arts case', () => {
    // Real tab name: "Contemporary Arts - Sec 1 Disci" (31 chars) — really
    // "...Sec 1 Discipline 2".
    const result = resolveIdentity(
      'Contemporary Arts - Sec 1 Disci',
      'Secondary 1 DISCIPLINE 2 - CONTEMPORARY ARTS'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S1',
      sectionName: 'Discipline 2',
    });
    expect(result.truncationNote).toContain('Discipline 2');
    expect(result.correctionNote).toBeNull();
  });

  it('does NOT misclassify a genuine disagreement (not a prefix relationship) as truncation', () => {
    // "Perseverance" is not a prefix of "Commitment" nor vice versa — this
    // must take the normal tab-wins correction path, not the truncation
    // path, even though both are "disagreements."
    const result = resolveIdentity(
      'English - P5 Perseverance',
      'Primary 5 COMMITMENT - ENGLISH'
    );
    expect(result.truncationNote).toBeNull();
    expect(result.correctionNote).not.toBeNull();
  });

  it('does NOT treat "tab name longer than row 2" as truncation (History real case — row 2 missing a trailing "2")', () => {
    // Real bug: tab says "Sec 2 Integrity 2" (correct), row 2 says
    // "INTEGRITY" (missing the "2") — row 2 is the SHORTER/wrong one here,
    // the opposite direction from truncation. Tab name must still win via
    // the normal correction path.
    const result = resolveIdentity(
      'History - Sec 2 Integrity 2',
      'Secondary 2 INTEGRITY - HISTORY'
    );
    expect(result.identity).toEqual({
      kind: 'secondary',
      levelCode: 'S2',
      sectionName: 'Integrity 2',
    });
    expect(result.truncationNote).toBeNull();
    expect(result.correctionNote).toContain('Integrity 2');
  });
});

describe('hasAnyScore', () => {
  it('returns false when every student has entirely null scores', () => {
    expect(
      hasAnyScore({
        levelCode: 'S1',
        sectionName: 'Discipline 2',
        students: [
          {
            wwScores: [null, null],
            ptScores: [null, null, null],
            examScore: null,
          },
          { wwScores: [null], ptScores: [null], examScore: null },
        ],
      })
    ).toBe(false);
  });

  it('returns true when at least one student has any real score', () => {
    expect(
      hasAnyScore({
        levelCode: 'S1',
        sectionName: 'Discipline 2',
        students: [
          {
            wwScores: [null, null],
            ptScores: [null, null, null],
            examScore: null,
          },
          { wwScores: [17, 15], ptScores: [19, 18, 17], examScore: 40 },
        ],
      })
    ).toBe(true);
  });
});

describe('isReservedTabName', () => {
  it('matches "Reserved N" tab names', () => {
    expect(isReservedTabName('Reserved 4')).toBe(true);
    expect(isReservedTabName('Reserved 1')).toBe(true);
    expect(isReservedTabName('reserved 12')).toBe(true);
  });

  it('does not match a real, descriptive tab name', () => {
    expect(isReservedTabName('Science - S1 Discipline 2')).toBe(false);
    expect(isReservedTabName('Science - Sec 1 Discipline 1')).toBe(false);
  });
});

describe('dedupePreferringNonReservedTab', () => {
  it('keeps a lone sheet untouched even if it came from a Reserved-named tab', () => {
    const lone = { levelCode: 'P2', sectionName: 'Gentleness' };
    const { kept, duplicateNotes } = dedupePreferringNonReservedTab([
      { sheetName: 'Reserved 2', sheet: lone },
    ]);
    expect(kept).toEqual([lone]);
    expect(duplicateNotes).toEqual([]);
  });

  it('drops a Reserved-named duplicate even when it has real scores — the real Science Reserved 4 vs Global Discipline 1 case', () => {
    const reservedButScored = { levelCode: 'S1', sectionName: 'Discipline 1' };
    const real = { levelCode: 'S1', sectionName: 'Discipline 1' };
    const { kept, duplicateNotes } = dedupePreferringNonReservedTab([
      { sheetName: 'Reserved 4', sheet: reservedButScored },
      { sheetName: 'Science - Sec 1 Discipline 1', sheet: real },
    ]);
    expect(kept).toEqual([real]);
    expect(duplicateNotes).toEqual([
      '"Reserved 4" and "Science - Sec 1 Discipline 1" both resolved to S1 Discipline 1 — "Reserved 4" is a Reserved slot, using "Science - Sec 1 Discipline 1"',
    ]);
  });

  it('keeps every sheet when the collision is ambiguous (zero or multiple non-Reserved candidates)', () => {
    const a = { levelCode: 'S2', sectionName: 'Integrity' };
    const b = { levelCode: 'S2', sectionName: 'Integrity' };
    const { kept, duplicateNotes } = dedupePreferringNonReservedTab([
      { sheetName: 'English - S2 Integrity', sheet: a },
      { sheetName: 'Science - S2 Integrity', sheet: b },
    ]);
    expect(kept).toEqual([a, b]);
    expect(duplicateNotes).toEqual([]);
  });
});
