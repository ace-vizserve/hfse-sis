import { describe, it, expect } from 'vitest';
import { qualityRampColorKey } from '@/components/dashboard/insights/bento/tokens';

describe('qualityRampColorKey', () => {
  const thresholds = { low: 70, high: 90 }; // midpoint = 80

  it('returns destructive below low', () => {
    expect(qualityRampColorKey(69, thresholds)).toBe('destructive');
    expect(qualityRampColorKey(0, thresholds)).toBe('destructive');
  });

  it('low is inclusive on the amber bin', () => {
    expect(qualityRampColorKey(70, thresholds)).toBe('amber');
  });

  it('returns amber between low and the midpoint', () => {
    expect(qualityRampColorKey(75, thresholds)).toBe('amber');
    expect(qualityRampColorKey(79.9, thresholds)).toBe('amber');
  });

  it('the midpoint is inclusive on the sky bin', () => {
    expect(qualityRampColorKey(80, thresholds)).toBe('sky');
  });

  it('returns sky between the midpoint and high', () => {
    expect(qualityRampColorKey(85, thresholds)).toBe('sky');
    expect(qualityRampColorKey(89.9, thresholds)).toBe('sky');
  });

  it('high is inclusive on the mint bin', () => {
    expect(qualityRampColorKey(90, thresholds)).toBe('mint');
  });

  it('returns mint at and above high', () => {
    expect(qualityRampColorKey(95, thresholds)).toBe('mint');
    expect(qualityRampColorKey(100, thresholds)).toBe('mint');
  });

  it('is monotonic across a swept range for asymmetric thresholds', () => {
    const t = { low: 60, high: 95 };
    const order: Record<string, number> = {
      destructive: 0,
      amber: 1,
      sky: 2,
      mint: 3,
    };
    let prevRank = -1;
    for (let v = 0; v <= 100; v += 1) {
      const rank = order[qualityRampColorKey(v, t)];
      expect(rank).toBeGreaterThanOrEqual(prevRank);
      prevRank = rank;
    }
  });
});
