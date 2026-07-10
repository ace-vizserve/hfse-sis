/**
 * Unit tests for lib/markbook/insights-compare.ts::selectTopMovementSubjects
 *
 * Pure logic — no rendering, no mocks. Selects which subjects plot as lines
 * on the Markbook Insights subject-performance trend chart: the top N by
 * |avg at first period with data − avg at latest period with data|.
 */
import { describe, expect, it } from 'vitest';

import {
  selectTopMovementSubjects,
  type TrendPoint,
} from '@/lib/markbook/insights-compare';

const periods = ['T1', 'T2', 'T3', 'T4'];

describe('selectTopMovementSubjects', () => {
  it('selects the top-N subjects by absolute first→latest movement, largest first', () => {
    const points: TrendPoint[] = [
      // Math: T1=70 → T4=90, movement 20
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 70,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 90,
      },
      // English: T1=80 → T4=82, movement 2
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'English',
        avgGrade: 80,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: 'English',
        avgGrade: 82,
      },
      // Science: T1=60 → T4=95, movement 35
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Science',
        avgGrade: 60,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: 'Science',
        avgGrade: 95,
      },
    ];

    const top = selectTopMovementSubjects(points, periods, 2);
    expect(top).toEqual(['Science', 'Math']);
  });

  it('caps at the default limit of 5 when more subjects are eligible', () => {
    const magnitudes = [5, 40, 15, 30, 10, 25, 1]; // 7 subjects, distinct movements
    const points: TrendPoint[] = magnitudes.flatMap((m, i) => [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: `Subject${i}`,
        avgGrade: 50,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: `Subject${i}`,
        avgGrade: 50 + m,
      },
    ]);

    const top = selectTopMovementSubjects(points, periods);
    expect(top).toHaveLength(5);
    // Movements: Subject1=40, Subject3=30, Subject5=25, Subject2=15, Subject4=10, Subject0=5, Subject6=1
    expect(top).toEqual([
      'Subject1',
      'Subject3',
      'Subject5',
      'Subject2',
      'Subject4',
    ]);
  });

  it('ties resolve alphabetically by subject name (stable, deterministic)', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Zoology',
        avgGrade: 70,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Zoology',
        avgGrade: 80,
      }, // movement 10
      { periodLabel: 'T1', ayCode: 'AY2026', subjectName: 'Art', avgGrade: 70 },
      { periodLabel: 'T2', ayCode: 'AY2026', subjectName: 'Art', avgGrade: 80 }, // movement 10, tie
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Music',
        avgGrade: 70,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Music',
        avgGrade: 80,
      }, // movement 10, tie
    ];

    const top = selectTopMovementSubjects(points, periods, 2);
    expect(top).toEqual(['Art', 'Music']);
  });

  it('a subject with a single data point has movement 0 and is still selectable', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Music',
        avgGrade: 88,
      },
    ];

    const top = selectTopMovementSubjects(points, periods, 5);
    expect(top).toEqual(['Music']);
  });

  it('a flat (zero-movement) subject still loses to a moving one under a tight limit', () => {
    const points: TrendPoint[] = [
      // Music: single point, movement 0
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Music',
        avgGrade: 88,
      },
      // Math: real movement
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 70,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 90,
      },
    ];

    const top = selectTopMovementSubjects(points, periods, 1);
    expect(top).toEqual(['Math']);
  });

  it('skips null avgGrade points when finding the first/latest period with data', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: null,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 70,
      },
      {
        periodLabel: 'T3',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: null,
      },
      {
        periodLabel: 'T4',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 90,
      },
    ];

    const top = selectTopMovementSubjects(points, periods, 5);
    expect(top).toEqual(['Math']); // movement = |90 - 70| = 20, still fine
  });

  it('empty input → empty array', () => {
    expect(selectTopMovementSubjects([], periods, 5)).toEqual([]);
    expect(selectTopMovementSubjects([], [], 5)).toEqual([]);
  });
});
