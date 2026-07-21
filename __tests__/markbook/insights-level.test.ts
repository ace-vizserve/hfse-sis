/**
 * Unit tests for lib/markbook/insights-level.ts
 *
 * Covers:
 *  1. buildSubjectLevelPoints — raw→typed conversion, avgGrade rounding.
 *  2. computeTermDelta — slope derivation, sorting, edge cases.
 *  3. computeFailingTailBySubject — tail %, band exclusion, latest-period selection.
 *  4. getWatchRowsByLevel — level grouping + top-N limit.
 *
 * All tests are pure — no rendering, no mocks, no server imports.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSubjectLevelPoints,
  computeFailingTailBySubject,
  computeTermDelta,
  FAILING_BAND_KEYS,
  getWatchRowsByLevel,
  highlightedLockTermNumber,
  selectTopRegressionMovers,
  type SubjectLevelDelta,
  type SubjectLevelRawPoint,
  type SubjectLevelTrendPoint,
} from '@/lib/markbook/insights-level';
import type { TermLockProgress } from '@/lib/markbook/dashboard';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRaw(
  overrides: Partial<SubjectLevelRawPoint> = {}
): SubjectLevelRawPoint {
  return {
    periodLabel: 'T1',
    ayCode: 'AY2026',
    termId: 'term-1',
    subjectName: 'Math',
    levelCode: 'P1',
    sum: 85,
    count: 1,
    failingCount: 0,
    ...overrides,
  };
}

function makePoint(
  overrides: Partial<SubjectLevelTrendPoint> = {}
): SubjectLevelTrendPoint {
  return {
    periodLabel: 'T1',
    ayCode: 'AY2026',
    termId: 'term-1',
    subjectName: 'Math',
    levelCode: 'P1',
    avgGrade: 85,
    entryCount: 1,
    ...overrides,
  };
}

// ── FAILING_BAND_KEYS ─────────────────────────────────────────────────────────

describe('FAILING_BAND_KEYS', () => {
  it('includes dnm and fs but not s, vs, o', () => {
    expect(FAILING_BAND_KEYS.has('dnm')).toBe(true);
    expect(FAILING_BAND_KEYS.has('fs')).toBe(true);
    expect(FAILING_BAND_KEYS.has('s')).toBe(false);
    expect(FAILING_BAND_KEYS.has('vs')).toBe(false);
    expect(FAILING_BAND_KEYS.has('o')).toBe(false);
  });
});

// ── buildSubjectLevelPoints ───────────────────────────────────────────────────

describe('buildSubjectLevelPoints', () => {
  it('computes avgGrade to 1dp from sum/count', () => {
    const raw = makeRaw({ sum: 256, count: 3 }); // 85.333…
    const [pt] = buildSubjectLevelPoints([raw]);
    expect(pt.avgGrade).toBe(85.3);
  });

  it('rounds 0.05 correctly (1dp banker-style is irrelevant — we use Math.round)', () => {
    const raw = makeRaw({ sum: 85.35 * 2, count: 2 }); // 85.35
    const [pt] = buildSubjectLevelPoints([raw]);
    expect(pt.avgGrade).toBe(85.4);
  });

  it('count 0 → avgGrade null', () => {
    const raw = makeRaw({ sum: 0, count: 0 });
    const [pt] = buildSubjectLevelPoints([raw]);
    expect(pt.avgGrade).toBeNull();
  });

  it('preserves all non-derived fields exactly', () => {
    const raw = makeRaw({
      periodLabel: 'T3',
      ayCode: 'AY2025',
      termId: 'term-xyz',
      subjectName: 'English',
      levelCode: 'S2',
      sum: 78,
      count: 1,
    });
    const [pt] = buildSubjectLevelPoints([raw]);
    expect(pt.periodLabel).toBe('T3');
    expect(pt.ayCode).toBe('AY2025');
    expect(pt.termId).toBe('term-xyz');
    expect(pt.subjectName).toBe('English');
    expect(pt.levelCode).toBe('S2');
    expect(pt.entryCount).toBe(1);
  });

  it('empty input → empty output', () => {
    expect(buildSubjectLevelPoints([])).toHaveLength(0);
  });

  it('multiple raw points → same-length output', () => {
    const raws = [
      makeRaw({ periodLabel: 'T1', sum: 80, count: 1 }),
      makeRaw({ periodLabel: 'T2', sum: 90, count: 1 }),
    ];
    expect(buildSubjectLevelPoints(raws)).toHaveLength(2);
  });
});

// ── computeTermDelta ──────────────────────────────────────────────────────────

describe('computeTermDelta', () => {
  it('computes delta as lastAvg − firstAvg', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({ periodLabel: 'T1', avgGrade: 80 }),
      makePoint({ periodLabel: 'T2', avgGrade: 85 }),
      makePoint({ periodLabel: 'T3', avgGrade: 78 }),
    ];
    const [delta] = computeTermDelta(points);
    // Math T1=80 T3=78: 78-80 = -2
    expect(delta.subjectName).toBe('Math');
    expect(delta.levelCode).toBe('P1');
    expect(delta.firstAvg).toBe(80);
    expect(delta.lastAvg).toBe(78);
    expect(delta.delta).toBe(-2);
    expect(delta.fromPeriod).toBe('T1');
    expect(delta.toPeriod).toBe('T3');
    expect(delta.termCount).toBe(3);
  });

  it('positive delta → improving subject listed after negative', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        subjectName: 'English',
        levelCode: 'P1',
        periodLabel: 'T1',
        avgGrade: 70,
      }),
      makePoint({
        subjectName: 'English',
        levelCode: 'P1',
        periodLabel: 'T2',
        avgGrade: 90,
      }),
      makePoint({
        subjectName: 'Science',
        levelCode: 'P1',
        periodLabel: 'T1',
        avgGrade: 85,
      }),
      makePoint({
        subjectName: 'Science',
        levelCode: 'P1',
        periodLabel: 'T2',
        avgGrade: 75,
      }),
    ];
    const deltas = computeTermDelta(points);
    // Sorted by delta ascending: Science (-10) first, English (+20) last.
    expect(deltas[0].subjectName).toBe('Science');
    expect(deltas[0].delta).toBe(-10);
    expect(deltas[1].subjectName).toBe('English');
    expect(deltas[1].delta).toBe(20);
  });

  it('single-point pair is excluded (no delta without 2 points)', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({ periodLabel: 'T1', avgGrade: 80 }),
    ];
    expect(computeTermDelta(points)).toHaveLength(0);
  });

  it('null avgGrade points are ignored (excluded from chronological sort)', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({ periodLabel: 'T1', avgGrade: null }),
      makePoint({ periodLabel: 'T2', avgGrade: 80 }),
      makePoint({ periodLabel: 'T3', avgGrade: 85 }),
    ];
    // T1 is null → only T2 and T3 form the pair → delta = 85-80 = +5
    const [delta] = computeTermDelta(points);
    expect(delta.firstAvg).toBe(80);
    expect(delta.lastAvg).toBe(85);
    expect(delta.delta).toBe(5);
    expect(delta.termCount).toBe(2);
  });

  it('empty input → empty output', () => {
    expect(computeTermDelta([])).toHaveLength(0);
  });

  it('different (subject × level) pairs produce separate deltas', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        subjectName: 'Math',
        levelCode: 'P1',
        periodLabel: 'T1',
        avgGrade: 80,
      }),
      makePoint({
        subjectName: 'Math',
        levelCode: 'P1',
        periodLabel: 'T2',
        avgGrade: 85,
      }),
      makePoint({
        subjectName: 'Math',
        levelCode: 'P2',
        periodLabel: 'T1',
        avgGrade: 70,
      }),
      makePoint({
        subjectName: 'Math',
        levelCode: 'P2',
        periodLabel: 'T2',
        avgGrade: 60,
      }),
    ];
    const deltas = computeTermDelta(points);
    expect(deltas).toHaveLength(2);
    const p1Delta = deltas.find((d) => d.levelCode === 'P1');
    const p2Delta = deltas.find((d) => d.levelCode === 'P2');
    expect(p1Delta?.delta).toBe(5);
    expect(p2Delta?.delta).toBe(-10);
  });

  it('delta rounds to 1dp', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({ periodLabel: 'T1', avgGrade: 80.0 }),
      makePoint({ periodLabel: 'T2', avgGrade: 82.3 }),
    ];
    const [delta] = computeTermDelta(points);
    expect(delta.delta).toBe(2.3);
  });
});

// ── computeFailingTailBySubject ───────────────────────────────────────────────

describe('computeFailingTailBySubject', () => {
  const periods = ['T1', 'T2', 'T3', 'T4'];

  it('uses the latest period with data', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({
        periodLabel: 'T1',
        subjectName: 'Math',
        levelCode: 'P1',
        count: 10,
        failingCount: 2,
      }),
      makeRaw({
        periodLabel: 'T2',
        subjectName: 'Math',
        levelCode: 'P1',
        count: 10,
        failingCount: 5,
      }),
    ];
    const [tail] = computeFailingTailBySubject(raw, periods);
    // Latest period with data is T2 → failingPct = 5/10 = 50%
    expect(tail.periodLabel).toBe('T2');
    expect(tail.failingPct).toBe(50);
  });

  it('aggregates across levels for a school-wide per-subject tail', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({
        periodLabel: 'T1',
        subjectName: 'Math',
        levelCode: 'P1',
        count: 10,
        failingCount: 3,
      }),
      makeRaw({
        periodLabel: 'T1',
        subjectName: 'Math',
        levelCode: 'P2',
        count: 10,
        failingCount: 1,
      }),
    ];
    // total = 20, failing = 4 → 20%
    const [tail] = computeFailingTailBySubject(raw, periods);
    expect(tail.subjectName).toBe('Math');
    expect(tail.failingCount).toBe(4);
    expect(tail.totalCount).toBe(20);
    expect(tail.failingPct).toBe(20);
  });

  it('sorts by failingPct descending: worst-tail first', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({
        periodLabel: 'T1',
        subjectName: 'English',
        levelCode: 'P1',
        count: 10,
        failingCount: 2,
      }),
      makeRaw({
        periodLabel: 'T1',
        subjectName: 'Math',
        levelCode: 'P1',
        count: 10,
        failingCount: 7,
      }),
    ];
    const tails = computeFailingTailBySubject(raw, periods);
    expect(tails[0].subjectName).toBe('Math'); // 70% failing
    expect(tails[1].subjectName).toBe('English'); // 20% failing
  });

  it('empty input → empty output', () => {
    expect(computeFailingTailBySubject([], periods)).toHaveLength(0);
  });

  it('empty periods → empty output', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({ periodLabel: 'T1', count: 10, failingCount: 2 }),
    ];
    expect(computeFailingTailBySubject(raw, [])).toHaveLength(0);
  });

  it('count 0 row is skipped (avoid division by zero)', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({ periodLabel: 'T1', count: 0, failingCount: 0 }),
    ];
    expect(computeFailingTailBySubject(raw, periods)).toHaveLength(0);
  });

  it('failingPct rounded to 1dp', () => {
    // 1/3 = 33.33…%
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({ periodLabel: 'T1', count: 3, failingCount: 1 }),
    ];
    const [tail] = computeFailingTailBySubject(raw, periods);
    expect(tail.failingPct).toBe(33.3);
  });

  it('0% failing when all entries are passing', () => {
    const raw: SubjectLevelRawPoint[] = [
      makeRaw({ periodLabel: 'T1', count: 10, failingCount: 0 }),
    ];
    const [tail] = computeFailingTailBySubject(raw, periods);
    expect(tail.failingPct).toBe(0);
  });
});

// ── getWatchRowsByLevel ───────────────────────────────────────────────────────

describe('getWatchRowsByLevel', () => {
  const periods = ['T1', 'T2', 'T3'];

  it('returns lowest-averaging subjects per level for the latest period', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        periodLabel: 'T2',
        levelCode: 'P1',
        subjectName: 'Math',
        avgGrade: 70,
      }),
      makePoint({
        periodLabel: 'T2',
        levelCode: 'P1',
        subjectName: 'English',
        avgGrade: 85,
      }),
      makePoint({
        periodLabel: 'T2',
        levelCode: 'P2',
        subjectName: 'Math',
        avgGrade: 78,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'Science',
        avgGrade: 60,
      }), // not T2
    ];
    const rows = getWatchRowsByLevel(points, periods, 3);
    // T2 is latest with data; P1 returns Math (70) + English (85), P2 returns Math (78)
    const p1Rows = rows.filter((r) => r.levelCode === 'P1');
    const p2Rows = rows.filter((r) => r.levelCode === 'P2');
    expect(p1Rows[0].subjectName).toBe('Math'); // lowest in P1
    expect(p2Rows[0].subjectName).toBe('Math');
    // T1-only Science should NOT appear
    expect(rows.find((r) => r.subjectName === 'Science')).toBeUndefined();
  });

  it('maxPerLevel caps rows per level', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'A',
        avgGrade: 60,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'B',
        avgGrade: 65,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'C',
        avgGrade: 70,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'D',
        avgGrade: 75,
      }),
    ];
    const rows = getWatchRowsByLevel(points, periods, 2);
    const p1Rows = rows.filter((r) => r.levelCode === 'P1');
    expect(p1Rows).toHaveLength(2);
    // Lowest 2: A (60) and B (65)
    expect(p1Rows[0].subjectName).toBe('A');
    expect(p1Rows[1].subjectName).toBe('B');
  });

  it('levels sorted naturally (P1 before P2, S1 before S2)', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        periodLabel: 'T1',
        levelCode: 'S1',
        subjectName: 'Science',
        avgGrade: 70,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'Math',
        avgGrade: 75,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P2',
        subjectName: 'English',
        avgGrade: 80,
      }),
    ];
    const rows = getWatchRowsByLevel(points, periods, 3);
    const levels = rows.map((r) => r.levelCode);
    expect(levels.indexOf('P1')).toBeLessThan(levels.indexOf('P2'));
    expect(levels.indexOf('P2')).toBeLessThan(levels.indexOf('S1'));
  });

  it('null avgGrade rows are excluded', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'Math',
        avgGrade: null,
      }),
      makePoint({
        periodLabel: 'T1',
        levelCode: 'P1',
        subjectName: 'English',
        avgGrade: 80,
      }),
    ];
    const rows = getWatchRowsByLevel(points, periods, 3);
    expect(rows.find((r) => r.subjectName === 'Math')).toBeUndefined();
    expect(rows.find((r) => r.subjectName === 'English')).toBeDefined();
  });

  it('empty points → empty output', () => {
    expect(getWatchRowsByLevel([], periods, 3)).toHaveLength(0);
  });

  it('empty periods → empty output', () => {
    const points: SubjectLevelTrendPoint[] = [
      makePoint({ periodLabel: 'T1', avgGrade: 80 }),
    ];
    expect(getWatchRowsByLevel(points, [], 3)).toHaveLength(0);
  });
});

// ── selectTopRegressionMovers ───────────────────────────────────────────────

function makeDelta(
  overrides: Partial<SubjectLevelDelta> = {}
): SubjectLevelDelta {
  return {
    subjectName: 'Math',
    levelCode: 'P1',
    firstAvg: 85,
    lastAvg: 85,
    delta: 0,
    termCount: 2,
    fromPeriod: 'T1',
    toPeriod: 'T2',
    ...overrides,
  };
}

describe('selectTopRegressionMovers', () => {
  it('selects the biggest movers by |delta|, both directions', () => {
    const deltas: SubjectLevelDelta[] = [
      makeDelta({ subjectName: 'A', delta: -1 }),
      makeDelta({ subjectName: 'B', delta: -8 }),
      makeDelta({ subjectName: 'C', delta: 1.5 }),
      makeDelta({ subjectName: 'D', delta: 6 }),
      makeDelta({ subjectName: 'E', delta: -0.2 }),
    ];
    const result = selectTopRegressionMovers(deltas, 3);
    // Top 3 by magnitude: B(-8), D(+6), C(1.5) — A(-1) and E(-0.2) excluded.
    // Re-sorted ascending by signed delta for display: B(-8) < C(1.5) < D(6).
    expect(result.map((r) => r.subjectName)).toEqual(['B', 'C', 'D']);
  });

  it('re-sorts the selected subset ascending by signed delta (worst first)', () => {
    const deltas: SubjectLevelDelta[] = [
      makeDelta({ subjectName: 'Improved', delta: 5 }),
      makeDelta({ subjectName: 'Declined', delta: -5 }),
    ];
    const result = selectTopRegressionMovers(deltas, 2);
    expect(result[0].subjectName).toBe('Declined');
    expect(result[1].subjectName).toBe('Improved');
  });

  it('includes at least one improvement when more than `limit` declines exist', () => {
    // 8 declines of varying magnitude + 1 improvement. A naive slice(0, 6)
    // off the ascending-by-delta order would show only declines.
    const deltas: SubjectLevelDelta[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeDelta({ subjectName: `Decline${i}`, delta: -(i + 1) })
      ),
      makeDelta({ subjectName: 'OnlyImprovement', delta: 20 }),
    ];
    const result = selectTopRegressionMovers(deltas, 6);
    expect(result.some((r) => r.subjectName === 'OnlyImprovement')).toBe(true);
  });

  it('default limit is 6', () => {
    const deltas: SubjectLevelDelta[] = Array.from({ length: 10 }, (_, i) =>
      makeDelta({ subjectName: `S${i}`, delta: -(i + 1) })
    );
    expect(selectTopRegressionMovers(deltas)).toHaveLength(6);
  });

  it('fewer deltas than limit → returns all of them', () => {
    const deltas: SubjectLevelDelta[] = [
      makeDelta({ subjectName: 'A', delta: -2 }),
      makeDelta({ subjectName: 'B', delta: 3 }),
    ];
    expect(selectTopRegressionMovers(deltas, 6)).toHaveLength(2);
  });

  it('empty input → empty output', () => {
    expect(selectTopRegressionMovers([], 6)).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const deltas: SubjectLevelDelta[] = [
      makeDelta({ subjectName: 'A', delta: -2 }),
      makeDelta({ subjectName: 'B', delta: 5 }),
    ];
    const copy = [...deltas];
    selectTopRegressionMovers(deltas, 1);
    expect(deltas).toEqual(copy);
  });
});

// ── highlightedLockTermNumber ────────────────────────────────────────────────

function makeLockProgress(
  overrides: Partial<TermLockProgress> = {}
): TermLockProgress {
  return {
    termNumber: 1,
    termLabel: 'Term 1',
    locked: 0,
    open: 0,
    ...overrides,
  };
}

describe('highlightedLockTermNumber', () => {
  it('highlights the term with the highest locked %', () => {
    const progress: TermLockProgress[] = [
      makeLockProgress({ termNumber: 1, locked: 142, open: 6 }), // 95.9%
      makeLockProgress({ termNumber: 2, locked: 130, open: 18 }), // 87.8%
      makeLockProgress({ termNumber: 3, locked: 90, open: 58 }), // 60.8%
      makeLockProgress({ termNumber: 4, locked: 0, open: 148 }), // 0%
    ];
    expect(highlightedLockTermNumber(progress)).toBe(1);
  });

  it('ties resolve to the first term in the array', () => {
    const progress: TermLockProgress[] = [
      makeLockProgress({ termNumber: 2, locked: 5, open: 5 }), // 50%
      makeLockProgress({ termNumber: 1, locked: 5, open: 5 }), // 50%
    ];
    expect(highlightedLockTermNumber(progress)).toBe(2);
  });

  it('a term with 0 total sheets contributes 0%, never wins over any real progress', () => {
    const progress: TermLockProgress[] = [
      makeLockProgress({ termNumber: 1, locked: 0, open: 0 }),
      makeLockProgress({ termNumber: 2, locked: 1, open: 9 }), // 10%
    ];
    expect(highlightedLockTermNumber(progress)).toBe(2);
  });

  it('empty input → null', () => {
    expect(highlightedLockTermNumber([])).toBeNull();
  });

  it('all-zero input → highlights the first term (all tied at 0%)', () => {
    const progress: TermLockProgress[] = [
      makeLockProgress({ termNumber: 1 }),
      makeLockProgress({ termNumber: 2 }),
    ];
    expect(highlightedLockTermNumber(progress)).toBe(1);
  });
});
