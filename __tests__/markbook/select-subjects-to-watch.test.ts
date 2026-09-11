/**
 * Unit tests for lib/markbook/insights-compare.ts::selectSubjectsToWatch
 *
 * Pure logic — no rendering, no mocks. Selects the "Subjects to watch" rows
 * for the Markbook Insights page: the lowest-averaging subjects in the
 * latest period that has any data, worst (lowest) first.
 */
import { describe, expect, it } from 'vitest';

import {
  selectSubjectsToWatch,
  type TrendPoint,
} from '@/lib/markbook/insights-compare';

describe('selectSubjectsToWatch', () => {
  it('returns the lowest-averaging subjects in the given period, ascending', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 70,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'English',
        avgGrade: 85,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Science',
        avgGrade: 60,
      },
    ];
    const rows = selectSubjectsToWatch(points, 'T2', 6);
    expect(rows.map((r) => r.subjectName)).toEqual([
      'Science',
      'Math',
      'English',
    ]);
  });

  it('caps at the given limit', () => {
    const points: TrendPoint[] = Array.from({ length: 10 }, (_, i) => ({
      periodLabel: 'T1',
      ayCode: 'AY2026',
      subjectName: `Subject${i}`,
      avgGrade: 50 + i,
    }));
    const rows = selectSubjectsToWatch(points, 'T1', 6);
    expect(rows).toHaveLength(6);
    // Lowest 6: Subject0..Subject5
    expect(rows.map((r) => r.subjectName)).toEqual([
      'Subject0',
      'Subject1',
      'Subject2',
      'Subject3',
      'Subject4',
      'Subject5',
    ]);
  });

  it('default limit is 6', () => {
    const points: TrendPoint[] = Array.from({ length: 10 }, (_, i) => ({
      periodLabel: 'T1',
      ayCode: 'AY2026',
      subjectName: `Subject${i}`,
      avgGrade: 50 + i,
    }));
    expect(selectSubjectsToWatch(points, 'T1')).toHaveLength(6);
  });

  it('only considers rows in the given period', () => {
    const points: TrendPoint[] = [
      { periodLabel: 'T1', ayCode: 'AY2026', subjectName: 'Old', avgGrade: 10 },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Current',
        avgGrade: 90,
      },
    ];
    const rows = selectSubjectsToWatch(points, 'T2', 6);
    expect(rows.map((r) => r.subjectName)).toEqual(['Current']);
  });

  it('excludes null avgGrade rows', () => {
    const points: TrendPoint[] = [
      { periodLabel: 'T1', ayCode: 'AY2026', subjectName: 'A', avgGrade: null },
      { periodLabel: 'T1', ayCode: 'AY2026', subjectName: 'B', avgGrade: 80 },
    ];
    const rows = selectSubjectsToWatch(points, 'T1', 6);
    expect(rows.map((r) => r.subjectName)).toEqual(['B']);
  });

  it('null period → empty array', () => {
    const points: TrendPoint[] = [
      { periodLabel: 'T1', ayCode: 'AY2026', subjectName: 'A', avgGrade: 80 },
    ];
    expect(selectSubjectsToWatch(points, null, 6)).toEqual([]);
  });

  it('empty input → empty array', () => {
    expect(selectSubjectsToWatch([], 'T1', 6)).toEqual([]);
  });

  it('a tie preserves the original relative order (stable sort)', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Zebra',
        avgGrade: 80,
      },
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Apple',
        avgGrade: 80,
      },
    ];
    const rows = selectSubjectsToWatch(points, 'T1', 6);
    expect(rows.map((r) => r.subjectName)).toEqual(['Zebra', 'Apple']);
  });
});
