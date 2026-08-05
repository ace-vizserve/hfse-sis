import { describe, expect, it } from 'vitest';

import {
  diffLevelsAwaitingSections,
  type WaitingAtLevel,
} from '@/lib/sis/levels-awaiting-sections';

// Level ids are opaque uuids in production; short readable stand-ins keep the
// expectations legible. sortOrder mirrors `levels.sort_order` (P1=1 … S4=10).
const P1 = { levelId: 'lvl-p1', levelLabel: 'Primary One', levelSortOrder: 1 };
const P2 = { levelId: 'lvl-p2', levelLabel: 'Primary Two', levelSortOrder: 2 };
const S4 = {
  levelId: 'lvl-s4',
  levelLabel: 'Secondary Four',
  levelSortOrder: 10,
};

function waiting(
  level: typeof P1,
  ayCode: string,
  enroleeNumbers: Array<string | null>
): WaitingAtLevel[] {
  return enroleeNumbers.map((enroleeNumber) => ({
    ...level,
    ayCode,
    enroleeNumber,
  }));
}

describe('diffLevelsAwaitingSections', () => {
  it('flags a level with waiting students and no sections', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', ['E-0001', 'E-0002', 'E-0003']),
      { AY2026: [] }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ayCode: 'AY2026',
      levelId: 'lvl-p1',
      levelLabel: 'Primary One',
      waitingCount: 3,
      sampleEnrolees: ['E-0001', 'E-0002', 'E-0003'],
    });
  });

  it('does NOT flag a level that already has at least one section', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', ['E-0001']),
      { AY2026: ['lvl-p1'] }
    );

    expect(result).toEqual([]);
  });

  // The whole reason this exists rather than reusing the AY-readiness
  // 'sections' step: Secondary Four has no students, so its empty section list
  // is not a problem and must not be reported as one.
  it('does NOT flag an empty level that nobody is waiting at', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', ['E-0001']),
      { AY2026: ['lvl-p1'] }
    );

    expect(result.map((r) => r.levelId)).not.toContain(S4.levelId);
    expect(result).toEqual([]);
  });

  it('treats an AY missing from the sections map as having no sections', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2027', ['E-0001']),
      {}
    );

    expect(result).toHaveLength(1);
    expect(result[0].ayCode).toBe('AY2027');
  });

  it('keeps each AY separate — same level, blocked in one year and fine in the other', () => {
    const result = diffLevelsAwaitingSections(
      [
        ...waiting(P1, 'AY2026', ['E-0001']),
        ...waiting(P1, 'AY2027', ['E-0002', 'E-0003']),
      ],
      { AY2026: ['lvl-p1'], AY2027: [] }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ayCode: 'AY2027',
      levelId: 'lvl-p1',
      waitingCount: 2,
    });
  });

  it('sorts by AY, then by level order — not alphabetically by label', () => {
    const result = diffLevelsAwaitingSections(
      [
        ...waiting(S4, 'AY2026', ['E-0004']),
        ...waiting(P2, 'AY2026', ['E-0002']),
        ...waiting(P1, 'AY2027', ['E-0001']),
        ...waiting(P1, 'AY2026', ['E-0003']),
      ],
      { AY2026: [], AY2027: [] }
    );

    expect(result.map((r) => `${r.ayCode}/${r.levelLabel}`)).toEqual([
      'AY2026/Primary One',
      'AY2026/Primary Two',
      // "Secondary Four" sorts before "Primary Two" alphabetically — level
      // order has to win, or the list reads backwards to a registrar.
      'AY2026/Secondary Four',
      'AY2027/Primary One',
    ]);
  });

  it('caps sample enrolees at 5 but keeps counting past the cap', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7']),
      { AY2026: [] }
    );

    expect(result[0].waitingCount).toBe(7);
    expect(result[0].sampleEnrolees).toEqual([
      'E-1',
      'E-2',
      'E-3',
      'E-4',
      'E-5',
    ]);
  });

  it('does not repeat an enrolee in the sample list', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', ['E-1', 'E-1', 'E-2']),
      { AY2026: [] }
    );

    expect(result[0].sampleEnrolees).toEqual(['E-1', 'E-2']);
  });

  it('counts a student with no enrolee number but leaves the sample list clean', () => {
    const result = diffLevelsAwaitingSections(
      waiting(P1, 'AY2026', [null, 'E-1']),
      { AY2026: [] }
    );

    expect(result[0].waitingCount).toBe(2);
    expect(result[0].sampleEnrolees).toEqual(['E-1']);
  });

  it('returns an empty array when nobody is waiting', () => {
    expect(diffLevelsAwaitingSections([], { AY2026: [] })).toEqual([]);
  });
});
