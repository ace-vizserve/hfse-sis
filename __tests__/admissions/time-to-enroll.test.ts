/**
 * Tests for the time-to-enrol metric.
 *
 * The `computeAverageTimeToEnrollment` pure helper is directly imported and
 * exercised here. It reads `enrolledAt` (the write-once timestamptz added by
 * migration 075) — NOT `applicationUpdatedDate` — so historical rows with
 * null enrolledAt produce sampleSize=0 and the UI shows a "building" neutral
 * state rather than a phantom "0 days."
 *
 * The local `computeAvgDaysToEnroll` mirror below is retained as documentation
 * of the same arithmetic so the test suite remains self-contained for CI.
 */

import { describe, expect, it } from 'vitest';

import { computeAverageTimeToEnrollment } from '@/lib/admissions/dashboard';

// ─── Tests against the exported pure helper ───────────────────────────────────

describe('computeAverageTimeToEnrollment — enrolledAt discipline', () => {
  it('sampleSize=0 when all enrolled rows have null enrolledAt (historical data pre-migration 075)', () => {
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-01-01T00:00:00Z',
        // enrolledAt null = no stamp yet (expected for all pre-075 rows)
        enrolledAt: null,
      },
    ];
    const result = computeAverageTimeToEnrollment(rows);
    // Must be 0 / 0 — never "0 days from a phantom 0-day computation"
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
      {
        applicationStatus: 'Cancelled',
        created_at: '2026-01-05T00:00:00Z',
        enrolledAt: '2026-02-10T00:00:00Z',
      },
    ];
    const result = computeAverageTimeToEnrollment(rows);
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
    const result = computeAverageTimeToEnrollment(rows);
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
    const result = computeAverageTimeToEnrollment(rows);
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
    const result = computeAverageTimeToEnrollment(rows);
    expect(result.sampleSize).toBe(0);
  });

  it('empty input returns sampleSize=0 (neutral state trigger)', () => {
    const result = computeAverageTimeToEnrollment([]);
    expect(result).toEqual({ avgDays: 0, sampleSize: 0 });
  });

  it('rounding: fractional day average rounds to nearest whole day', () => {
    // 10 days + 11 days = 21 days total; avg = 10.5 → rounds to 11
    const rows = [
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-01-01T00:00:00Z',
        enrolledAt: '2026-01-11T00:00:00Z', // 10 days
      },
      {
        applicationStatus: 'Enrolled',
        created_at: '2026-02-01T00:00:00Z',
        enrolledAt: '2026-02-12T00:00:00Z', // 11 days
      },
    ];
    const result = computeAverageTimeToEnrollment(rows);
    expect(result.sampleSize).toBe(2);
    expect(result.avgDays).toBe(11); // Math.round(10.5) = 11
  });
});
