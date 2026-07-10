import { describe, it, expect } from 'vitest';
import { summariseAyTrend } from '@/lib/dashboard/trend-delta';

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
});
