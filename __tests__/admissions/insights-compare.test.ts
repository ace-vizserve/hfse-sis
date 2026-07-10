import { describe, it, expect } from 'vitest';
import {
  shapeIntakeTrendPoints,
  computeIntakeTrendCutoffs,
  currentInProgressMonthLabel,
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

// ---------------------------------------------------------------------------
// computeIntakeTrendCutoffs — the DB-`is_current` clamp fix.
//
// Regression: the old ladder compared the AY-CODE's numeric year against
// today's calendar year to decide "has this AY started/ended" — so a
// future-coded AY holding real, saved data (the AY9999 test environment,
// seeded with 2026-dated rows; or any early is_current rollover) always fell
// into the "future AY" branch and every month nulled out despite full rows
// in the DB. The fix: clamp trailing months ONLY for the AY the DB flags
// `is_current`; every other AY (regardless of what its code's digits say)
// renders exactly what is saved, unclamped.
// ---------------------------------------------------------------------------

describe('computeIntakeTrendCutoffs', () => {
  it('a future-coded AY (isCurrent: false) with saved data → no clamp (cutoff 10, the AY9999 regression)', () => {
    const cutoffs = computeIntakeTrendCutoffs(
      [{ ayCode: 'AY9999', isCurrent: false }],
      5 // real current month = June, irrelevant since not current
    );
    expect(cutoffs.get('AY9999')).toBe(10);
  });

  it('isCurrent: true → cutoff clamps to Math.min(currentMonth, 10)', () => {
    const cutoffs = computeIntakeTrendCutoffs(
      [{ ayCode: 'AY2026', isCurrent: true }],
      3 // April, 0-based
    );
    expect(cutoffs.get('AY2026')).toBe(3);
  });

  it('isCurrent: true and currentMonth is December (11) → cutoff clamps to 10 (Nov, HFSE AY window)', () => {
    const cutoffs = computeIntakeTrendCutoffs(
      [{ ayCode: 'AY2026', isCurrent: true }],
      11
    );
    expect(cutoffs.get('AY2026')).toBe(10);
  });

  it('a past AY (isCurrent: false) → unchanged full render (cutoff 10)', () => {
    const cutoffs = computeIntakeTrendCutoffs(
      [{ ayCode: 'AY2025', isCurrent: false }],
      5
    );
    expect(cutoffs.get('AY2025')).toBe(10);
  });

  it('handles a mixed current + non-current pair independently', () => {
    const cutoffs = computeIntakeTrendCutoffs(
      [
        { ayCode: 'AY2026', isCurrent: true },
        { ayCode: 'AY9999', isCurrent: false },
      ],
      4
    );
    expect(cutoffs.get('AY2026')).toBe(4);
    expect(cutoffs.get('AY9999')).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// currentInProgressMonthLabel — keys on `isCurrent`, not `ayYear === currentYear`.
// ---------------------------------------------------------------------------

describe('currentInProgressMonthLabel', () => {
  it('returns null when isCurrent is false, regardless of the date', () => {
    expect(
      currentInProgressMonthLabel(false, new Date('2026-06-15T00:00:00Z'))
    ).toBeNull();
  });

  it('returns the current month label when isCurrent is true', () => {
    expect(
      currentInProgressMonthLabel(true, new Date('2026-06-15T00:00:00Z'))
    ).toBe('Jun');
  });

  it('returns null in December even when isCurrent is true (outside the HFSE AY window)', () => {
    expect(
      currentInProgressMonthLabel(true, new Date('2026-12-05T00:00:00Z'))
    ).toBeNull();
  });
});
