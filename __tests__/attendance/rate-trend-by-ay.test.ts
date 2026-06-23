/**
 * Unit tests for `shapeRateTrendPoints` — the pure reshaping core of
 * `getAttendanceRateTrendByAy` in lib/attendance/insights-compare.ts.
 *
 * The DB-touching wrapper is verified by build + manual walkthrough.
 * These tests confirm the pure shaping logic: Map<AY, Map<term, pct>> →
 * AyTrendPoint[] with correct periodLabels and null passthrough.
 */
import { describe, expect, it } from 'vitest';

import { shapeRateTrendPoints } from '@/lib/attendance/insights-compare';

describe('shapeRateTrendPoints', () => {
  it('single AY with all 4 terms → 4 points', () => {
    const input = new Map([
      [
        'AY2026',
        new Map<number, number | null>([
          [1, 95.5],
          [2, 94.2],
          [3, 93.0],
          [4, 96.1],
        ]),
      ],
    ]);
    const pts = shapeRateTrendPoints(input);
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p.periodLabel)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(pts.every((p) => p.ayCode === 'AY2026')).toBe(true);
    expect(pts[0].value).toBeCloseTo(95.5);
    expect(pts[3].value).toBeCloseTo(96.1);
  });

  it('null values pass through (gap, not zero)', () => {
    const input = new Map([
      [
        'AY2026',
        new Map<number, number | null>([
          [1, 95.0],
          [2, null],
          [3, 92.0],
        ]),
      ],
    ]);
    const pts = shapeRateTrendPoints(input);
    const t2 = pts.find((p) => p.periodLabel === 'T2' && p.ayCode === 'AY2026');
    expect(t2).toBeDefined();
    expect(t2?.value).toBeNull();
  });

  it('two AYs → correct interleaving with right ay codes', () => {
    const input = new Map([
      [
        'AY2026',
        new Map<number, number | null>([
          [1, 95.0],
          [2, 94.0],
        ]),
      ],
      [
        'AY2025',
        new Map<number, number | null>([
          [1, 92.0],
          [2, 91.0],
        ]),
      ],
    ]);
    const pts = shapeRateTrendPoints(input);
    // 2 AYs × 2 terms = 4 points total
    expect(pts).toHaveLength(4);
    const ay26T1 = pts.find(
      (p) => p.ayCode === 'AY2026' && p.periodLabel === 'T1'
    );
    const ay25T1 = pts.find(
      (p) => p.ayCode === 'AY2025' && p.periodLabel === 'T1'
    );
    expect(ay26T1?.value).toBeCloseTo(95.0);
    expect(ay25T1?.value).toBeCloseTo(92.0);
  });

  it('empty map → empty array', () => {
    expect(shapeRateTrendPoints(new Map())).toEqual([]);
  });

  it('AY with no terms → no points for that AY', () => {
    const input = new Map([
      ['AY2026', new Map<number, number | null>()],
      ['AY2025', new Map<number, number | null>([[1, 90.0]])],
    ]);
    const pts = shapeRateTrendPoints(input);
    const ay26pts = pts.filter((p) => p.ayCode === 'AY2026');
    expect(ay26pts).toHaveLength(0);
    const ay25pts = pts.filter((p) => p.ayCode === 'AY2025');
    expect(ay25pts).toHaveLength(1);
  });
});
