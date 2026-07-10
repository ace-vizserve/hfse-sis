import { describe, it, expect } from 'vitest';
import {
  summariseAyTrend,
  summariseSeriesMovement,
} from '@/lib/dashboard/trend-delta';

describe('summariseAyTrend', () => {
  it('anchors on the current series latest non-null value, not the raw last row', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [
      { x: 'T1', AY2026: 90, AY2025: 88 },
      { x: 'T2', AY2026: 92, AY2025: 89 },
      { x: 'T3', AY2026: null, AY2025: 91 }, // current has no T3 data yet
      { x: 'T4', AY2026: null, AY2025: 92 },
    ];
    const summary = summariseAyTrend(data, series);
    expect(summary.periodLabel).toBe('T2');
    expect(summary.currentValue).toBe(92);
    expect(summary.comparisonValue).toBe(89); // AY2025's T2, not its later T3/T4
    expect(summary.delta).not.toBeNull();
    expect(summary.delta?.direction).toBe('up');
  });

  it('no comparison series → delta is null, no fake pill', () => {
    const series = [{ key: 'AY2026', label: 'AY2026', muted: false }];
    const data = [{ x: 'T1', AY2026: 90 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.currentValue).toBe(90);
    expect(summary.comparisonValue).toBeNull();
    expect(summary.delta).toBeNull();
  });

  it('comparison series present but no value at the anchor period → delta is null', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'T1', AY2026: 90, AY2025: null }];
    const summary = summariseAyTrend(data, series);
    expect(summary.currentValue).toBe(90);
    expect(summary.comparisonValue).toBeNull();
    expect(summary.delta).toBeNull();
  });

  it('no current data anywhere → all null, no anchor period', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'T1', AY2026: null, AY2025: 88 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.periodLabel).toBeNull();
    expect(summary.currentValue).toBeNull();
    expect(summary.delta).toBeNull();
  });

  it('direction: down when current < comparison', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'T1', AY2026: 80, AY2025: 90 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.delta?.direction).toBe('down');
    expect(summary.delta?.abs).toBe(-10);
  });

  it('direction: flat when current === comparison', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'T1', AY2026: 85, AY2025: 85 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.delta?.direction).toBe('flat');
    expect(summary.delta?.abs).toBe(0);
  });

  it('honesty guard: pct is null (not Infinity) when the comparison value is 0', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'Jan', AY2026: 12, AY2025: 0 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.delta?.pct).toBeNull();
    expect(summary.delta?.abs).toBe(12);
    expect(summary.delta?.direction).toBe('up');
  });

  // ── Partial-period anchor guard (opts.inProgressPeriod) ────────────────────
  // For month-granularity COUNT series, the anchor can land on the current
  // in-progress month (e.g. 10 days into July). Comparing that partial total
  // against a full historical month fabricates a decline. When the caller
  // identifies the anchor as in-progress, the delta must be suppressed while
  // the headline value/periodLabel stay intact ("count so far" is honest).

  it('partial-period guard: anchor equals inProgressPeriod → delta null, headline intact', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [
      { x: 'Jun', AY2026: 40, AY2025: 38 },
      { x: 'Jul', AY2026: 10, AY2025: 35 }, // Jul is 10 days in; AY2025's Jul is a full month
    ];
    const summary = summariseAyTrend(data, series, {
      inProgressPeriod: 'Jul',
    });
    expect(summary.periodLabel).toBe('Jul');
    expect(summary.currentValue).toBe(10);
    expect(summary.comparisonValue).toBe(35);
    expect(summary.delta).toBeNull();
  });

  it('partial-period guard: anchor differs from inProgressPeriod → delta unchanged', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'Jun', AY2026: 40, AY2025: 38 }];
    const summary = summariseAyTrend(data, series, {
      inProgressPeriod: 'Jul',
    });
    expect(summary.periodLabel).toBe('Jun');
    expect(summary.delta).not.toBeNull();
    expect(summary.delta?.abs).toBe(2);
    expect(summary.delta?.direction).toBe('up');
  });

  it('partial-period guard: option omitted → behavior unchanged (delta still computed)', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'Jul', AY2026: 10, AY2025: 35 }];
    const summary = summariseAyTrend(data, series);
    expect(summary.periodLabel).toBe('Jul');
    expect(summary.delta).not.toBeNull();
    expect(summary.delta?.abs).toBe(-25);
  });

  it('partial-period guard: inProgressPeriod null → behaves as if omitted', () => {
    const series = [
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ];
    const data = [{ x: 'Jul', AY2026: 10, AY2025: 35 }];
    const summary = summariseAyTrend(data, series, {
      inProgressPeriod: null,
    });
    expect(summary.delta).not.toBeNull();
  });
});

describe('summariseSeriesMovement', () => {
  it('movement up: latest value + first→latest delta labelled against the first period', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: 80 },
      { x: 'T2', value: 84 },
      { x: 'T3', value: 86.5 },
    ]);
    expect(summary.periodLabel).toBe('T3');
    expect(summary.currentValue).toBe(86.5);
    expect(summary.delta).not.toBeNull();
    expect(summary.delta?.label).toBe('+6.5 vs T1');
    expect(summary.delta?.direction).toBe('up');
  });

  it('movement down: negative delta keeps its minus sign', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: 90 },
      { x: 'T2', value: 85 },
    ]);
    expect(summary.periodLabel).toBe('T2');
    expect(summary.currentValue).toBe(85);
    expect(summary.delta?.label).toBe('-5 vs T1');
    expect(summary.delta?.direction).toBe('down');
  });

  it('flat: zero movement still reports, direction flat', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: 88 },
      { x: 'T2', value: 88 },
    ]);
    expect(summary.delta?.label).toBe('+0 vs T1');
    expect(summary.delta?.direction).toBe('flat');
  });

  it('single data point → headline only, no delta (never fabricate)', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: null },
      { x: 'T2', value: 91 },
      { x: 'T3', value: null },
    ]);
    expect(summary.periodLabel).toBe('T2');
    expect(summary.currentValue).toBe(91);
    expect(summary.delta).toBeNull();
  });

  it('empty input → all null, null-safe', () => {
    const summary = summariseSeriesMovement([]);
    expect(summary.periodLabel).toBeNull();
    expect(summary.currentValue).toBeNull();
    expect(summary.delta).toBeNull();
  });

  it('all-null values → all null, no anchor period', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: null },
      { x: 'T2', value: null },
    ]);
    expect(summary.periodLabel).toBeNull();
    expect(summary.currentValue).toBeNull();
    expect(summary.delta).toBeNull();
  });

  it('leading and trailing nulls are skipped when finding first/latest', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: null },
      { x: 'T2', value: 78 },
      { x: 'T3', value: 82 },
      { x: 'T4', value: null },
    ]);
    expect(summary.periodLabel).toBe('T3');
    expect(summary.currentValue).toBe(82);
    expect(summary.delta?.label).toBe('+4 vs T2');
    expect(summary.delta?.direction).toBe('up');
  });

  it('rounds the delta to 1 decimal place', () => {
    const summary = summariseSeriesMovement([
      { x: 'T1', value: 80.12 },
      { x: 'T2', value: 83.37 },
    ]);
    expect(summary.delta?.label).toBe('+3.3 vs T1');
  });
});
