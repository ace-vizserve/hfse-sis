import { describe, it, expect } from 'vitest';
import {
  shapeIntakeTrendPoints,
  AY_MONTH_LABELS,
} from '@/lib/admissions/insights-compare';

describe('shapeIntakeTrendPoints', () => {
  it('counts applications per month, zero-fills in-AY months, nulls future months', () => {
    const rows = [
      // AY2026 — 2 in Jan, 1 in Feb; cutoff is Feb (month 1)
      { ayCode: 'AY2026', createdAt: '2026-01-10T00:00:00Z' },
      { ayCode: 'AY2026', createdAt: '2026-01-20T00:00:00Z' },
      { ayCode: 'AY2026', createdAt: '2026-02-05T00:00:00Z' },
    ];

    // todayMonthByAy: AY2026 → cutoff month 1 (February, 0-based)
    const todayMonthByAy = new Map([['AY2026', 1]]);
    const points = shapeIntakeTrendPoints(rows, todayMonthByAy);

    // Jan
    const jan = points.find(
      (p) => p.periodLabel === 'Jan' && p.ayCode === 'AY2026'
    );
    expect(jan?.value).toBe(2);

    // Feb
    const feb = points.find(
      (p) => p.periodLabel === 'Feb' && p.ayCode === 'AY2026'
    );
    expect(feb?.value).toBe(1);

    // Mar (month 2) is beyond the cutoff (1) → null
    const mar = points.find(
      (p) => p.periodLabel === 'Mar' && p.ayCode === 'AY2026'
    );
    expect(mar?.value).toBeNull();

    // Nov (month 10) is also null (future)
    const nov = points.find(
      (p) => p.periodLabel === 'Nov' && p.ayCode === 'AY2026'
    );
    expect(nov?.value).toBeNull();
  });

  it('includes all 11 months (Jan–Nov) for a historical AY (cutoff 10)', () => {
    const rows = [{ ayCode: 'AY2025', createdAt: '2025-03-01T00:00:00Z' }];
    const todayMonthByAy = new Map([['AY2025', 10]]);
    const points = shapeIntakeTrendPoints(rows, todayMonthByAy);

    // Should have exactly 11 months for AY2025
    const ay2025Points = points.filter((p) => p.ayCode === 'AY2025');
    expect(ay2025Points).toHaveLength(11);

    // Every label is one of the 11 AY_MONTH_LABELS
    const labels = ay2025Points.map((p) => p.periodLabel);
    expect(labels).toEqual([...AY_MONTH_LABELS]);

    // March has 1 application; all others 0 (not null — they're in the past)
    const mar = points.find(
      (p) => p.periodLabel === 'Mar' && p.ayCode === 'AY2025'
    );
    expect(mar?.value).toBe(1);

    const jan = points.find(
      (p) => p.periodLabel === 'Jan' && p.ayCode === 'AY2025'
    );
    expect(jan?.value).toBe(0);
  });

  it('skips December (month 11) rows', () => {
    const rows = [
      { ayCode: 'AY2025', createdAt: '2025-12-01T00:00:00Z' }, // December — skip
      { ayCode: 'AY2025', createdAt: '2025-01-15T00:00:00Z' }, // January — keep
    ];
    const todayMonthByAy = new Map([['AY2025', 10]]);
    const points = shapeIntakeTrendPoints(rows, todayMonthByAy);

    const jan = points.find(
      (p) => p.periodLabel === 'Jan' && p.ayCode === 'AY2025'
    );
    expect(jan?.value).toBe(1);

    // No December point should exist
    const dec = points.find((p) => p.periodLabel === 'Dec');
    expect(dec).toBeUndefined();
  });

  it('returns empty array for empty rows', () => {
    expect(shapeIntakeTrendPoints([], new Map())).toEqual([]);
  });

  it('handles two AYs independently', () => {
    const rows = [
      { ayCode: 'AY2026', createdAt: '2026-01-05T00:00:00Z' },
      { ayCode: 'AY2025', createdAt: '2025-01-10T00:00:00Z' },
      { ayCode: 'AY2025', createdAt: '2025-02-10T00:00:00Z' },
    ];
    const todayMonthByAy = new Map([
      ['AY2026', 0], // Jan only (cutoff month 0)
      ['AY2025', 10], // all months
    ]);
    const points = shapeIntakeTrendPoints(rows, todayMonthByAy);

    // AY2026: Jan = 1, Feb = null (future)
    const ay26Jan = points.find(
      (p) => p.ayCode === 'AY2026' && p.periodLabel === 'Jan'
    );
    expect(ay26Jan?.value).toBe(1);
    const ay26Feb = points.find(
      (p) => p.ayCode === 'AY2026' && p.periodLabel === 'Feb'
    );
    expect(ay26Feb?.value).toBeNull();

    // AY2025: Jan = 1, Feb = 1, Mar = 0
    const ay25Jan = points.find(
      (p) => p.ayCode === 'AY2025' && p.periodLabel === 'Jan'
    );
    expect(ay25Jan?.value).toBe(1);
    const ay25Feb = points.find(
      (p) => p.ayCode === 'AY2025' && p.periodLabel === 'Feb'
    );
    expect(ay25Feb?.value).toBe(1);
    const ay25Mar = points.find(
      (p) => p.ayCode === 'AY2025' && p.periodLabel === 'Mar'
    );
    expect(ay25Mar?.value).toBe(0);
  });
});
