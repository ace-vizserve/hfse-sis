/**
 * Unit tests for lib/markbook/insights-compare.ts
 *
 * Pure logic — no rendering, no mocks. Fast and exhaustive.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMultiAyTrend,
  topBandBadge,
  type TrendPoint,
} from '@/lib/markbook/insights-compare';

// ── topBandBadge ──────────────────────────────────────────────────────────────

describe('topBandBadge', () => {
  it('compareAy null → Building history (muted)', () => {
    const badge = topBandBadge(60, 55, null);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('compareTopBandPct null → No data for {compareAy} (muted)', () => {
    const badge = topBandBadge(60, null, 'AY2025');
    expect(badge.label).toBe('No data for AY2025');
    expect(badge.tone).toBe('muted');
  });

  it('topBandPct null → Building history (muted)', () => {
    const badge = topBandBadge(null, 55, 'AY2025');
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('both null + compareAy null → Building history (muted) — compareAy check first', () => {
    const badge = topBandBadge(null, null, null);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('positive delta → ▲ Npp vs {compareAy} (mint)', () => {
    // 65 - 55 = 10
    const badge = topBandBadge(65, 55, 'AY2025');
    expect(badge.label).toBe('▲ 10pp vs AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('equal delta (0) → ▲ 0pp vs {compareAy} (mint)', () => {
    const badge = topBandBadge(55, 55, 'AY2025');
    expect(badge.label).toBe('▲ 0pp vs AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('negative delta → ▼ |N|pp vs {compareAy} (amber)', () => {
    // 45 - 55 = -10
    const badge = topBandBadge(45, 55, 'AY2025');
    expect(badge.label).toBe('▼ 10pp vs AY2025');
    expect(badge.tone).toBe('amber');
  });

  it('delta rounds to integer (0.49 → 0 → positive)', () => {
    // 55.3 - 55.0 = 0.3 → rounds to 0
    const badge = topBandBadge(55.3, 55.0, 'AY2025');
    expect(badge.label).toBe('▲ 0pp vs AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('large negative delta uses absolute value', () => {
    const badge = topBandBadge(10, 80, 'AY2024');
    expect(badge.label).toBe('▼ 70pp vs AY2024');
    expect(badge.tone).toBe('amber');
  });
});

// ── buildMultiAyTrend ─────────────────────────────────────────────────────────

describe('buildMultiAyTrend', () => {
  const periods = ['T1', 'T2', 'T3', 'T4'];

  // ── Single-AY path ────────────────────────────────────────────────────────

  describe('single AY', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 85,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 88,
      },
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'English',
        avgGrade: 79,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'English',
        avgGrade: 82,
      },
    ];

    it('series keys are namespaced {subject} · {ay}', () => {
      const { series } = buildMultiAyTrend(points, periods, ['AY2026']);
      for (const s of series) {
        expect(s.key).toContain(' · AY2026');
      }
    });

    it('series labels are bare subject names (no AY suffix)', () => {
      const { series } = buildMultiAyTrend(points, periods, ['AY2026']);
      const labels = series.map((s) => s.label);
      expect(labels).toContain('English');
      expect(labels).toContain('Math');
      // No AY code in label
      for (const label of labels) {
        expect(label).not.toContain('AY2026');
      }
    });

    it('data rows have correct values for known periods', () => {
      const { data } = buildMultiAyTrend(points, periods, ['AY2026']);
      const t1 = data.find((r) => r.x === 'T1');
      const t2 = data.find((r) => r.x === 'T2');
      expect(t1?.['Math · AY2026']).toBe(85);
      expect(t2?.['Math · AY2026']).toBe(88);
      expect(t1?.['English · AY2026']).toBe(79);
    });

    it('missing point → null in the data row', () => {
      const { data } = buildMultiAyTrend(points, periods, ['AY2026']);
      // T3 and T4 have no data
      const t3 = data.find((r) => r.x === 'T3');
      expect(t3?.['Math · AY2026']).toBeNull();
      expect(t3?.['English · AY2026']).toBeNull();
    });
  });

  // ── Two-AY path ───────────────────────────────────────────────────────────

  describe('two AYs', () => {
    const points: TrendPoint[] = [
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 85,
      },
      {
        periodLabel: 'T2',
        ayCode: 'AY2026',
        subjectName: 'Math',
        avgGrade: 88,
      },
      {
        periodLabel: 'T1',
        ayCode: 'AY2025',
        subjectName: 'Math',
        avgGrade: 80,
      },
      {
        periodLabel: 'T3',
        ayCode: 'AY2025',
        subjectName: 'Math',
        avgGrade: 83,
      },
      {
        periodLabel: 'T1',
        ayCode: 'AY2026',
        subjectName: 'Science',
        avgGrade: 76,
      },
    ];
    const ays = ['AY2026', 'AY2025'];

    it('same subject in two AYs → two distinct keys (no collision)', () => {
      const { series } = buildMultiAyTrend(points, periods, ays);
      const keys = series.map((s) => s.key);
      expect(keys).toContain('Math · AY2026');
      expect(keys).toContain('Math · AY2025');
      // All keys are unique
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('series labels carry AY code when multiple AYs', () => {
      const { series } = buildMultiAyTrend(points, periods, ays);
      const mathAy26 = series.find((s) => s.key === 'Math · AY2026');
      const mathAy25 = series.find((s) => s.key === 'Math · AY2025');
      expect(mathAy26?.label).toBe('Math (AY2026)');
      expect(mathAy25?.label).toBe('Math (AY2025)');
    });

    it('data row carries values for BOTH AY series of the same subject', () => {
      const { data } = buildMultiAyTrend(points, periods, ays);
      const t1 = data.find((r) => r.x === 'T1');
      expect(t1?.['Math · AY2026']).toBe(85);
      expect(t1?.['Math · AY2025']).toBe(80);
    });

    it('a period present in one AY but not the other → null for the missing one', () => {
      const { data } = buildMultiAyTrend(points, periods, ays);
      // T2 has Math AY2026 (88) but no Math AY2025 entry
      const t2 = data.find((r) => r.x === 'T2');
      expect(t2?.['Math · AY2026']).toBe(88);
      expect(t2?.['Math · AY2025']).toBeNull();
      // T3 has Math AY2025 (83) but no Math AY2026 entry
      const t3 = data.find((r) => r.x === 'T3');
      expect(t3?.['Math · AY2026']).toBeNull();
      expect(t3?.['Math · AY2025']).toBe(83);
    });

    it('subject present in only one AY still gets a series for both', () => {
      const { series } = buildMultiAyTrend(points, periods, ays);
      // Science only has AY2026 data but both series should appear
      const scienceKeys = series.filter((s) => s.key.startsWith('Science'));
      expect(scienceKeys.map((s) => s.key)).toContain('Science · AY2026');
      expect(scienceKeys.map((s) => s.key)).toContain('Science · AY2025');
    });

    it('subjects sorted alphabetically', () => {
      const { series } = buildMultiAyTrend(points, periods, ays);
      // Math comes before Science alphabetically; each subject has both AYs
      const firstSubject = series[0].key.split(' · ')[0];
      const lastSubject = series[series.length - 1].key.split(' · ')[0];
      expect(firstSubject).toBe('Math');
      expect(lastSubject).toBe('Science');
    });

    it('AY order within a subject follows the ays parameter (primary first)', () => {
      const { series } = buildMultiAyTrend(points, periods, [
        'AY2026',
        'AY2025',
      ]);
      const mathSeries = series.filter((s) => s.key.startsWith('Math'));
      expect(mathSeries[0].key).toBe('Math · AY2026');
      expect(mathSeries[1].key).toBe('Math · AY2025');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty points → empty series and data rows (one per period, only x)', () => {
      const { data, series } = buildMultiAyTrend([], periods, ['AY2026']);
      expect(series).toHaveLength(0);
      expect(data).toHaveLength(periods.length);
      for (const row of data) {
        expect(Object.keys(row)).toEqual(['x']);
      }
    });

    it('empty periods → empty data', () => {
      const points: TrendPoint[] = [
        {
          periodLabel: 'T1',
          ayCode: 'AY2026',
          subjectName: 'Math',
          avgGrade: 85,
        },
      ];
      const { data } = buildMultiAyTrend(points, [], ['AY2026']);
      expect(data).toHaveLength(0);
    });

    it('avgGrade null in point → null in data row', () => {
      const points: TrendPoint[] = [
        {
          periodLabel: 'T1',
          ayCode: 'AY2026',
          subjectName: 'Math',
          avgGrade: null,
        },
      ];
      const { data } = buildMultiAyTrend(points, ['T1'], ['AY2026']);
      expect(data[0]?.['Math · AY2026']).toBeNull();
    });
  });
});
