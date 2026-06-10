import { describe, it, expect } from 'vitest';
import { rollupTerminalReasons, growthDelta } from '@/lib/admissions/insights';

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
