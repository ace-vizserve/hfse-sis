/**
 * Unit tests for `shapeAttendanceMixPoints` — the pure reshaping core of
 * `getAttendanceMixByTerm` in lib/attendance/insights-compare.ts.
 *
 * The DB-touching wrapper is verified by build + manual walkthrough, same
 * convention as `shapeRateTrendPoints` (see rate-trend-by-ay.test.ts).
 * These tests confirm: term-number-keyed sub-counts → AttendanceTermMixPoint[]
 * with correct `level` labels, and zero-encoded-days terms skipped entirely
 * (no all-zero bar on the stacked chart).
 */
import { describe, expect, it } from 'vitest';

import { shapeAttendanceMixPoints } from '@/lib/attendance/insights-compare';

describe('shapeAttendanceMixPoints', () => {
  it('all 4 terms encoded → 4 points, correct level labels and counts', () => {
    const input = new Map([
      [1, { present: 40, late: 2, excused: 1, absent: 1, encodedDays: 44 }],
      [2, { present: 38, late: 1, excused: 3, absent: 2, encodedDays: 44 }],
      [3, { present: 41, late: 0, excused: 0, absent: 1, encodedDays: 42 }],
      [4, { present: 39, late: 3, excused: 1, absent: 0, encodedDays: 43 }],
    ]);
    const pts = shapeAttendanceMixPoints(input);
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p.level)).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(pts[0]).toEqual({
      level: 'T1',
      Present: 40,
      Late: 2,
      Excused: 1,
      Absent: 1,
    });
  });

  it('a term with zero encoded days is skipped entirely — no all-zero bar', () => {
    const input = new Map([
      [1, { present: 40, late: 2, excused: 1, absent: 1, encodedDays: 44 }],
      [2, { present: 38, late: 1, excused: 3, absent: 2, encodedDays: 44 }],
      [3, { present: 0, late: 0, excused: 0, absent: 0, encodedDays: 0 }],
      [4, { present: 0, late: 0, excused: 0, absent: 0, encodedDays: 0 }],
    ]);
    const pts = shapeAttendanceMixPoints(input);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.level)).toEqual(['T1', 'T2']);
  });

  it('empty map → empty array', () => {
    expect(shapeAttendanceMixPoints(new Map())).toEqual([]);
  });

  it('a term with real marks but a genuine zero absent count still renders (only encodedDays===0 skips)', () => {
    const input = new Map([
      [1, { present: 45, late: 0, excused: 0, absent: 0, encodedDays: 45 }],
    ]);
    const pts = shapeAttendanceMixPoints(input);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({
      level: 'T1',
      Present: 45,
      Late: 0,
      Excused: 0,
      Absent: 0,
    });
  });
});
