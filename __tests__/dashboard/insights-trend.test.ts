import { describe, it, expect } from 'vitest';
import {
  buildAyTrend,
  sparklineFromAyTrend,
} from '@/lib/dashboard/insights-trend';

describe('buildAyTrend', () => {
  it('aligns two AYs on the same relative periods, one series each', () => {
    const points = [
      { periodLabel: 'T1', ayCode: 'AY2026', value: 97 },
      { periodLabel: 'T2', ayCode: 'AY2026', value: 96 },
      { periodLabel: 'T1', ayCode: 'AY2025', value: 98.5 },
      { periodLabel: 'T2', ayCode: 'AY2025', value: 98.8 },
    ];
    const { data, series } = buildAyTrend(
      points,
      ['T1', 'T2', 'T3', 'T4'],
      ['AY2026', 'AY2025']
    );
    expect(series).toEqual([
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ]);
    expect(data[0]).toEqual({ x: 'T1', AY2026: 97, AY2025: 98.5 });
    expect(data[2]).toEqual({ x: 'T3', AY2026: null, AY2025: null }); // missing period → gap
  });

  it('single AY → one solid series, no muted', () => {
    const points = [{ periodLabel: 'T1', ayCode: 'AY2026', value: 97 }];
    const { series } = buildAyTrend(points, ['T1'], ['AY2026']);
    expect(series).toEqual([{ key: 'AY2026', label: 'AY2026', muted: false }]);
  });
});

describe('sparklineFromAyTrend', () => {
  it('extracts only the current-AY (series[0]) series, ignoring the comparison AY', () => {
    const points = [
      { periodLabel: 'T1', ayCode: 'AY2026', value: 97 },
      { periodLabel: 'T2', ayCode: 'AY2026', value: 96 },
      { periodLabel: 'T1', ayCode: 'AY2025', value: 98.5 },
      { periodLabel: 'T2', ayCode: 'AY2025', value: 98.8 },
    ];
    const trend = buildAyTrend(points, ['T1', 'T2'], ['AY2026', 'AY2025']);
    expect(sparklineFromAyTrend(trend)).toEqual([
      { x: 'T1', y: 97 },
      { x: 'T2', y: 96 },
    ]);
  });

  it('drops null (future/un-encoded) periods rather than fabricating a zero', () => {
    const points = [{ periodLabel: 'T1', ayCode: 'AY2026', value: 97 }];
    const trend = buildAyTrend(points, ['T1', 'T2', 'T3'], ['AY2026']);
    expect(sparklineFromAyTrend(trend)).toEqual([{ x: 'T1', y: 97 }]);
  });

  it('returns an empty array when there is no series at all', () => {
    const trend = buildAyTrend([], [], []);
    expect(sparklineFromAyTrend(trend)).toEqual([]);
  });
});
