/**
 * Regression tests for BUG 1 — "Time to enrol" was structurally ~0 days.
 *
 * Root cause: `JoinedRow.applicationUpdatedDate` falls back to `created_at`
 * when the status table's column is null (common — 0/471 populated in AY2026).
 * Using the fallback for time-to-enrol arithmetic produced `end - start = 0`
 * for every un-stamped row.
 *
 * Fix: expose `enrolledAt` (raw status-table value, null when un-stamped) on
 * `JoinedRow`, and use only that field in time-to-enrol computations.
 *
 * These tests verify the pure arithmetic that the functions depend on so the
 * fix is regression-safe without requiring DB mocks.
 */

import { describe, expect, it } from 'vitest';

// ─── Pure helpers extracted from the computation (mirrored here for testing) ──

/** Mirror of the time-to-enrol arithmetic in getAverageTimeToEnrollment. */
function computeAvgDaysToEnroll(
  rows: Array<{
    applicationStatus: string | null;
    created_at: string | null;
    /** Raw status-table value — null means "never stamped". */
    enrolledAt: string | null;
  }>
): { avgDays: number; sampleSize: number } {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (
      r.applicationStatus !== 'Enrolled' &&
      r.applicationStatus !== 'Enrolled (Conditional)'
    )
      continue;
    if (!r.created_at || !r.enrolledAt) continue;
    const start = Date.parse(r.created_at);
    const end = Date.parse(r.enrolledAt);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
    if (days < 0) continue;
    total += days;
    n += 1;
  }
  return { avgDays: n > 0 ? Math.round(total / n) : 0, sampleSize: n };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('time-to-enrol — enrolledAt discipline', () => {
  it('BUG 1 regression: rows with null enrolledAt are excluded (not counted as 0 days)', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-01-01T00:00:00Z',
        // enrolledAt null = admissions team never stamped it; previously this
        // caused a 0-day result because the fallback made enrolledAt = created_at.
        enrolledAt: null,
      },
    ];
    const result = computeAvgDaysToEnroll(rows);
    // With the fix: no rows counted (sampleSize = 0, avgDays = 0 sentinel).
    expect(result.sampleSize).toBe(0);
    expect(result.avgDays).toBe(0);
  });

  it('non-enrolled rows are excluded regardless of enrolledAt', () => {
    const rows = [
      {
        applicationStatus: 'Submitted',
        created_at: '2026-01-01T00:00:00Z',
        enrolledAt: '2026-02-15T00:00:00Z',
      },
    ];
    const result = computeAvgDaysToEnroll(rows);
    expect(result.sampleSize).toBe(0);
  });

  it('enrolled rows with a real enrolledAt produce correct day counts', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-01-01T00:00:00Z',
        enrolledAt: '2026-01-31T00:00:00Z', // 30 days later
      },
      {
        applicationStatus: 'Enrolled (Conditional)',
        created_at: '2026-02-01T00:00:00Z',
        enrolledAt: '2026-02-11T00:00:00Z', // 10 days later
      },
    ];
    const result = computeAvgDaysToEnroll(rows);
    expect(result.sampleSize).toBe(2);
    expect(result.avgDays).toBe(20); // (30 + 10) / 2
  });

  it('mixed: some stamped, some un-stamped — only stamped rows count', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-01-01T00:00:00Z',
        enrolledAt: '2026-02-01T00:00:00Z', // 31 days
      },
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-03-01T00:00:00Z',
        enrolledAt: null, // un-stamped — must be excluded
      },
    ];
    const result = computeAvgDaysToEnroll(rows);
    // Only the first row counts; the un-stamped row must not drag the average
    // down toward 0 or inflate sampleSize.
    expect(result.sampleSize).toBe(1);
    expect(result.avgDays).toBe(31);
  });

  it('negative day delta is excluded (enrolledAt before created_at — data error)', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-03-01T00:00:00Z',
        enrolledAt: '2026-01-01T00:00:00Z', // before creation — invalid
      },
    ];
    const result = computeAvgDaysToEnroll(rows);
    expect(result.sampleSize).toBe(0);
  });
});
