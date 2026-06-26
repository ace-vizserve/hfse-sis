// __tests__/sis/year-setup.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSelectedAyCode, ayStatusTone } from '@/lib/sis/year-setup';

const ays = [
  { ay_code: 'AY2027', is_current: false },
  { ay_code: 'AY2026', is_current: true },
  { ay_code: 'AY2025', is_current: false },
];

describe('resolveSelectedAyCode', () => {
  it('returns the requested code when it is a real AY', () => {
    expect(resolveSelectedAyCode(ays, 'AY2027')).toBe('AY2027');
  });

  it('falls back to the active AY when requested is missing or invalid', () => {
    expect(resolveSelectedAyCode(ays, 'AY9999')).toBe('AY2026');
    expect(resolveSelectedAyCode(ays, undefined)).toBe('AY2026');
  });

  it('falls back to the first AY when none is active', () => {
    const noActive = ays.map((a) => ({ ...a, is_current: false }));
    expect(resolveSelectedAyCode(noActive, undefined)).toBe('AY2027');
  });

  it('returns null when there are no AYs', () => {
    expect(resolveSelectedAyCode([], 'AY2026')).toBeNull();
  });
});

describe('ayStatusTone', () => {
  it('is active when the AY is current', () => {
    expect(
      ayStatusTone({ is_current: true, accepting_applications: false })
    ).toBe('active');
  });

  it('is early-bird when not current but accepting applications', () => {
    expect(
      ayStatusTone({ is_current: false, accepting_applications: true })
    ).toBe('early-bird');
  });

  it('is inactive otherwise', () => {
    expect(
      ayStatusTone({ is_current: false, accepting_applications: false })
    ).toBe('inactive');
  });
});
