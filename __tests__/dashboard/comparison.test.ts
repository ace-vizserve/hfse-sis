/**
 * Unit tests for lib/dashboard/comparison.ts
 *
 * Pure logic — no rendering, no mocks. Fast and exhaustive.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPARE_NONE,
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';

const AY_CODES = ['AY2026', 'AY2025', 'AY2024', 'AY2023'] as const;
const SELECTED = 'AY2026';

// ── resolveCompareAy ──────────────────────────────────────────────────────────

describe('resolveCompareAy', () => {
  it('explicit COMPARE_NONE sentinel → null (user turned comparison off)', () => {
    expect(resolveCompareAy(COMPARE_NONE, AY_CODES, SELECTED)).toBeNull();
  });

  it('explicit "none" string → null (same as the constant)', () => {
    expect(resolveCompareAy('none', AY_CODES, SELECTED)).toBeNull();
  });

  it('valid AY code (in list, != selectedAy) → that AY', () => {
    expect(resolveCompareAy('AY2025', AY_CODES, SELECTED)).toBe('AY2025');
  });

  it('valid AY code that is the same as selectedAy → falls back to inferred prior', () => {
    // AY2026 is selectedAy → same, so infer AY2025
    expect(resolveCompareAy('AY2026', AY_CODES, 'AY2026')).toBe('AY2025');
  });

  it('invalid AY code (not in list) → falls back to inferred prior', () => {
    expect(resolveCompareAy('AY9999', AY_CODES, SELECTED)).toBe('AY2025');
  });

  it('absent (undefined) → inferred prior (preserves no-regression default)', () => {
    expect(resolveCompareAy(undefined, AY_CODES, SELECTED)).toBe('AY2025');
  });

  it('array form → treated as absent → inferred prior', () => {
    // Only string is accepted; array falls through to undefined path
    expect(resolveCompareAy(['AY2025'], AY_CODES, SELECTED)).toBe('AY2025');
  });

  it('selectedAy is the oldest in the list → inferred prior is null', () => {
    // AY2023 is last → no prior AY
    expect(resolveCompareAy(undefined, AY_CODES, 'AY2023')).toBeNull();
  });

  it('selectedAy not in list → inferred prior is null (indexOf = -1)', () => {
    expect(resolveCompareAy(undefined, AY_CODES, 'AY9999')).toBeNull();
  });

  it('valid middle AY → inferred prior is the code after it in the list', () => {
    // AY2025 → next index is AY2024
    expect(resolveCompareAy(undefined, AY_CODES, 'AY2025')).toBe('AY2024');
  });

  it('explicit AY at a non-adjacent slot → returns exactly that code', () => {
    // Jump two years back
    expect(resolveCompareAy('AY2023', AY_CODES, SELECTED)).toBe('AY2023');
  });
});

// ── comparisonCardState ───────────────────────────────────────────────────────

describe('comparisonCardState', () => {
  it('compareAy null → "building"', () => {
    expect(comparisonCardState(null, false)).toBe('building');
    expect(comparisonCardState(null, true)).toBe('building');
  });

  it('compareAy set, hasComparisonData false → "no-data"', () => {
    expect(comparisonCardState('AY2025', false)).toBe('no-data');
  });

  it('compareAy set, hasComparisonData true → "ok"', () => {
    expect(comparisonCardState('AY2025', true)).toBe('ok');
  });
});
