/**
 * Unit tests for lib/attendance/insights-watchlist.ts
 *
 * Pure logic — no I/O, no mocks.
 */
import { describe, expect, it } from 'vitest';

import {
  splitWatchlist,
  computeAbsenceMix,
  isApproachingVlQuota,
  type WatchlistEntry,
} from '@/lib/attendance/insights-watchlist';
import type { TopAbsentDrillRow } from '@/lib/attendance/drill';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(
  name: string,
  absences: number,
  excused: number,
  lates = 0
): TopAbsentDrillRow {
  return {
    studentSectionId: `ss-${name}`,
    studentName: name,
    studentNumber: `SN-${name}`,
    sectionId: 'sec-1',
    sectionName: 'P3 Obedience',
    level: 'P3',
    absences,
    lates,
    excused,
    encodedDays: absences + excused + lates + 40, // nominal present days
    attendancePct: Math.round(
      ((40 + lates + excused) / (absences + excused + lates + 40)) * 100
    ),
  };
}

// ─── splitWatchlist ──────────────────────────────────────────────────────────

describe('splitWatchlist — bucket assignment', () => {
  it('A > EX → intervene', () => {
    const row = makeRow('Alice', 5, 2); // 5 A, 2 EX: A majority
    const { intervene, monitor } = splitWatchlist([row]);
    expect(intervene).toHaveLength(1);
    expect(monitor).toHaveLength(0);
    expect(intervene[0].studentName).toBe('Alice');
  });

  it('EX > A → monitor', () => {
    const row = makeRow('Bob', 2, 5); // 2 A, 5 EX: EX majority
    const { intervene, monitor } = splitWatchlist([row]);
    expect(intervene).toHaveLength(0);
    expect(monitor).toHaveLength(1);
    expect(monitor[0].studentName).toBe('Bob');
  });

  it('A === EX → monitor (tie goes to monitor)', () => {
    const row = makeRow('Carol', 3, 3); // equal — not majority unexplained
    const { intervene, monitor } = splitWatchlist([row]);
    expect(intervene).toHaveLength(0);
    expect(monitor).toHaveLength(1);
  });

  it('absences === 0 → excluded from both lists', () => {
    const row = makeRow('Dan', 0, 5); // no A — healthy enough
    const { intervene, monitor } = splitWatchlist([row]);
    expect(intervene).toHaveLength(0);
    expect(monitor).toHaveLength(0);
  });

  it('A > 0 and EX === 0 → intervene (fully unexplained)', () => {
    const row = makeRow('Eve', 4, 0);
    const { intervene, monitor } = splitWatchlist([row]);
    expect(intervene).toHaveLength(1);
    expect(monitor).toHaveLength(0);
  });
});

describe('splitWatchlist — enriched fields', () => {
  it('computes awayDays correctly', () => {
    const row = makeRow('Frank', 3, 4);
    const { monitor } = splitWatchlist([row]);
    expect(monitor[0].awayDays).toBe(7);
  });

  it('computes unexplainedPct for intervene row', () => {
    const row = makeRow('Grace', 7, 3); // 7/(7+3) = 70%
    const { intervene } = splitWatchlist([row]);
    expect(intervene[0].unexplainedPct).toBe(70);
  });

  it('unexplainedPct rounds half-up (3/5 = 60%)', () => {
    const row = makeRow('Hana', 3, 2); // 3/5 = 60%
    const { intervene } = splitWatchlist([row]);
    expect(intervene[0].unexplainedPct).toBe(60);
  });
});

describe('splitWatchlist — limit cap', () => {
  it('caps both lists at limit', () => {
    const rows = [
      makeRow('A', 10, 1), // intervene
      makeRow('B', 8, 1), // intervene
      makeRow('C', 6, 1), // intervene
      makeRow('D', 2, 5), // monitor
      makeRow('E', 1, 6), // monitor
    ];
    const result = splitWatchlist(rows, 2);
    expect(result.intervene).toHaveLength(2);
    expect(result.monitor).toHaveLength(2);
    // Highest absences first
    expect(result.intervene[0].studentName).toBe('A');
    expect(result.intervene[1].studentName).toBe('B');
  });
});

describe('splitWatchlist — sort order', () => {
  it('sorts each bucket by absences desc', () => {
    // Pass rows in reverse order to verify re-sort
    const rows = [
      makeRow('Low', 2, 0),
      makeRow('High', 8, 0),
      makeRow('Mid', 4, 0),
    ];
    const { intervene } = splitWatchlist(rows);
    expect(intervene.map((r) => r.studentName)).toEqual(['High', 'Mid', 'Low']);
  });

  it('tie-breaks by lates desc', () => {
    const rows = [makeRow('NoLate', 5, 0, 0), makeRow('Late', 5, 0, 3)];
    const { intervene } = splitWatchlist(rows);
    expect(intervene[0].studentName).toBe('Late');
  });
});

// ─── computeAbsenceMix ──────────────────────────────────────────────────────

describe('computeAbsenceMix', () => {
  it('typical mix: 40 A, 60 EX', () => {
    const mix = computeAbsenceMix(40, 60);
    expect(mix.awayDays).toBe(100);
    expect(mix.unexplainedPct).toBe(40);
    expect(mix.excusedPct).toBe(60);
  });

  it('zero away-days → all zeros', () => {
    const mix = computeAbsenceMix(0, 0);
    expect(mix.awayDays).toBe(0);
    expect(mix.unexplainedPct).toBe(0);
    expect(mix.excusedPct).toBe(0);
  });

  it('all unexplained → 100% / 0%', () => {
    const mix = computeAbsenceMix(10, 0);
    expect(mix.unexplainedPct).toBe(100);
    expect(mix.excusedPct).toBe(0);
  });

  it('all excused → 0% / 100%', () => {
    const mix = computeAbsenceMix(0, 10);
    expect(mix.unexplainedPct).toBe(0);
    expect(mix.excusedPct).toBe(100);
  });

  it('percentages always sum to 100', () => {
    // Test a case where naive rounding would break this (1/3 ≈ 33.3%)
    const mix = computeAbsenceMix(1, 2); // 1/3 = 33%
    expect(mix.unexplainedPct + mix.excusedPct).toBe(100);
  });

  it('raw counts preserved', () => {
    const mix = computeAbsenceMix(15, 25);
    expect(mix.unexplained).toBe(15);
    expect(mix.excused).toBe(25);
  });
});

// ─── isApproachingVlQuota ───────────────────────────────────────────────────

describe('isApproachingVlQuota', () => {
  it('remaining === 0 and not over → approaching', () => {
    expect(isApproachingVlQuota(0, false)).toBe(true);
  });

  it('remaining > 0 → not approaching', () => {
    expect(isApproachingVlQuota(1, false)).toBe(false);
  });

  it('remaining === 0 but isOver → over (not approaching)', () => {
    // isOver means they went past the limit; approaching is pre-breach only
    expect(isApproachingVlQuota(0, true)).toBe(false);
  });

  it('remaining < 0 (over quota) → isApproaching false', () => {
    // remainingThisTerm is max(0, allowance - used) in the rollup, so
    // this should never occur in practice — but we guard defensively.
    expect(isApproachingVlQuota(-1, true)).toBe(false);
  });
});
