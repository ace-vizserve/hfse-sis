import { describe, it, expect } from 'vitest';
import {
  rollupTerminalReasons,
  growthDelta,
  reasonLabel,
  selectTopReasonBars,
  TOP_REASON_COUNT,
} from '@/lib/admissions/insights';
import type { ReasonCount } from '@/lib/admissions/insights';

describe('rollupTerminalReasons', () => {
  it('counts reasons overall and by level, sorted desc, null/blank -> "Unspecified"', () => {
    const rows = [
      { applicationTerminalReason: 'Chose another school', levelApplied: 'P1' },
      { applicationTerminalReason: 'Chose another school', levelApplied: 'P2' },
      { applicationTerminalReason: 'Fees', levelApplied: 'P1' },
      { applicationTerminalReason: null, levelApplied: 'P1' },
      { applicationTerminalReason: '', levelApplied: 'S1' },
    ];
    const out = rollupTerminalReasons(rows);
    // overall: Chose another school 2, Fees 1, Unspecified 2 -> sorted desc
    expect(out.overall[0]).toEqual({
      reason: 'Chose another school',
      count: 2,
    });
    expect(out.total).toBe(5);
    // by level: P1 has 3 (Chose another school 1, Fees 1, Unspecified 1)
    const p1 = out.byLevel.find((l) => l.level === 'P1');
    expect(p1?.count).toBe(3);
  });

  it('returns empty shape for no rows', () => {
    const out = rollupTerminalReasons([]);
    expect(out).toEqual({ overall: [], byLevel: [], total: 0 });
  });
});

describe('reasonLabel', () => {
  it('humanizes a known terminal-reason code', () => {
    expect(reasonLabel('other')).toBe('Other');
  });

  it('falls back to the raw string for an unmapped value', () => {
    expect(reasonLabel('Some free-text reason')).toBe('Some free-text reason');
  });
});

describe('selectTopReasonBars', () => {
  it('names every reason when there are TOP_REASON_COUNT or fewer', () => {
    const overall: ReasonCount[] = [
      { reason: 'Chose another school', count: 5 },
      { reason: 'Fees', count: 3 },
    ];
    expect(selectTopReasonBars(overall)).toEqual([
      { key: 'Chose another school', label: 'Chose another school', count: 5 },
      { key: 'Fees', label: 'Fees', count: 3 },
    ]);
  });

  it('folds everything past TOP_REASON_COUNT into a single "Other reasons" bucket', () => {
    const overall: ReasonCount[] = Array.from(
      { length: TOP_REASON_COUNT + 2 },
      (_, i) => ({
        reason: `Reason ${i}`,
        count: TOP_REASON_COUNT + 2 - i, // strictly descending, already "sorted"
      })
    );
    const bars = selectTopReasonBars(overall);
    expect(bars).toHaveLength(TOP_REASON_COUNT + 1);
    expect(bars.slice(0, TOP_REASON_COUNT)).toEqual(
      overall
        .slice(0, TOP_REASON_COUNT)
        .map((r) => ({ key: r.reason, label: r.reason, count: r.count }))
    );
    const overflow = bars[TOP_REASON_COUNT];
    expect(overflow.key).toBe('other_reasons');
    expect(overflow.label).toBe('Other reasons');
    // Sum of the two reasons past the top 5: counts 2 and 1.
    expect(overflow.count).toBe(3);
  });

  it('omits the overflow bucket entirely when there is nothing past the top N', () => {
    const overall: ReasonCount[] = Array.from(
      { length: TOP_REASON_COUNT },
      (_, i) => ({
        reason: `Reason ${i}`,
        count: 1,
      })
    );
    const bars = selectTopReasonBars(overall);
    expect(bars).toHaveLength(TOP_REASON_COUNT);
    expect(bars.some((b) => b.key === 'other_reasons')).toBe(false);
  });

  it('returns an empty list for no reasons', () => {
    expect(selectTopReasonBars([])).toEqual([]);
  });
});

describe('growthDelta', () => {
  it('computes pct change vs prior, null prior -> null pct', () => {
    expect(growthDelta(120, 100)).toEqual({
      current: 120,
      prior: 100,
      pct: 20,
    });
    expect(growthDelta(100, 0)).toEqual({ current: 100, prior: 0, pct: null });
    expect(growthDelta(80, null)).toEqual({
      current: 80,
      prior: null,
      pct: null,
    });
  });
});
