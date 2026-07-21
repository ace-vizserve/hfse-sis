import { describe, expect, it } from 'vitest';
import { classifyProfile } from '@/components/sis/weight-profile';

describe('classifyProfile', () => {
  it('returns "correct" when weights match the subject code\'s real bucket', () => {
    expect(classifyProfile('MATH', 40, 40, 20)).toBe('correct');
    expect(classifyProfile('MAPEH', 20, 60, 20)).toBe('correct');
    expect(classifyProfile('ENG', 30, 50, 20)).toBe('correct');
  });

  it('returns "custom" when weights sum to 100 but don\'t match the subject\'s bucket', () => {
    // ENG's real bucket is 30/50/20 — a Math/Science split on it is custom.
    expect(classifyProfile('ENG', 40, 40, 20)).toBe('custom');
    // MATH's real bucket is 40/40/20 — a MAPEH-family split on it is custom.
    expect(classifyProfile('MATH', 20, 60, 20)).toBe('custom');
  });

  it('returns "invalid" when the weights don\'t sum to 100, regardless of subject code', () => {
    expect(classifyProfile('MATH', 40, 40, 19)).toBe('invalid');
    expect(classifyProfile('ENG', 30, 50, 21)).toBe('invalid');
  });

  it('unknown subject codes fall back to the default bucket (30/50/20) for classification', () => {
    expect(classifyProfile('NONSENSE', 30, 50, 20)).toBe('correct');
    expect(classifyProfile('NONSENSE', 40, 40, 20)).toBe('custom');
  });
});
