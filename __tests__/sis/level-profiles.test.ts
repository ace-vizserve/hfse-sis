import { describe, expect, it } from 'vitest';
import {
  LEVEL_WEIGHT_PROFILES,
  weightProfileFor,
} from '@/lib/sis/level-profiles';

describe('level weight profiles', () => {
  it('primary is 40/40/20', () => {
    expect(LEVEL_WEIGHT_PROFILES.primary).toEqual({
      ww: 0.4,
      pt: 0.4,
      qa: 0.2,
    });
  });
  it('secondary is 30/50/20', () => {
    expect(LEVEL_WEIGHT_PROFILES.secondary).toEqual({
      ww: 0.3,
      pt: 0.5,
      qa: 0.2,
    });
  });
  it('each profile sums to 1', () => {
    for (const p of Object.values(LEVEL_WEIGHT_PROFILES))
      expect(p.ww + p.pt + p.qa).toBeCloseTo(1);
  });
  it('preschool and unknown types have no profile', () => {
    expect(weightProfileFor('preschool')).toBeNull();
    expect(weightProfileFor('nonsense')).toBeNull();
  });
});
