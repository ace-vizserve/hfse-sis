/**
 * Unit tests for lib/attendance/insights-compare.ts
 *
 * Verifies the `rateBadge` helper — the single source of truth for the
 * Attendance Insights hero badge AND the Section-1 card comparison signal.
 * Regression guard: hero and section card must agree in all three cases.
 *
 * Pure logic — no rendering, no mocks. Fast and exhaustive.
 */
import { describe, expect, it } from 'vitest';

import { rateBadge } from '@/lib/attendance/insights-compare';

const COMPARE_AY = 'AY2025';

// ── no real comparison data → always Building history / muted ────────────────

describe('rateBadge — no comparison data (hasRateData = false)', () => {
  it('compareAy null, hasRateData false → Building history (muted)', () => {
    const badge = rateBadge(95, null, false, null);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('compareAy set, hasRateData false (zero encoded days) → Building history (muted)', () => {
    // This is the core FIX 1 regression case: priorRate would be 0 (computed
    // from priorKpis with encodedDays === 0), but we gate on hasRateData, not
    // on priorRate === null, so we must NOT show "95% vs 0% in AY2025".
    const badge = rateBadge(95, 0, false, COMPARE_AY);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('hasRateData false regardless of priorRate being non-null → Building history (muted)', () => {
    const badge = rateBadge(90, 85, false, COMPARE_AY);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('priorRate null (no prior kpis at all), hasRateData false → Building history (muted)', () => {
    const badge = rateBadge(95, null, false, null);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });
});

// ── hasRateData true — real comparison data ──────────────────────────────────

describe('rateBadge — real comparison data (hasRateData = true)', () => {
  it('rate > priorRate → mint with "X% vs Y% in AY"', () => {
    const badge = rateBadge(95.5, 92.3, true, COMPARE_AY);
    expect(badge.label).toBe('95.5% vs 92.3% in AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('rate === priorRate → mint (at-or-above counts as healthy)', () => {
    const badge = rateBadge(93, 93, true, COMPARE_AY);
    expect(badge.label).toBe('93% vs 93% in AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('rate < priorRate → amber with "X% vs Y% in AY"', () => {
    const badge = rateBadge(88, 93, true, COMPARE_AY);
    expect(badge.label).toBe('88% vs 93% in AY2025');
    expect(badge.tone).toBe('amber');
  });

  it('large difference above → mint', () => {
    const badge = rateBadge(99, 70, true, COMPARE_AY);
    expect(badge.label).toBe('99% vs 70% in AY2025');
    expect(badge.tone).toBe('mint');
  });

  it('large difference below → amber', () => {
    const badge = rateBadge(60, 95, true, COMPARE_AY);
    expect(badge.label).toBe('60% vs 95% in AY2025');
    expect(badge.tone).toBe('amber');
  });
});

// ── defensive: priorRate null despite hasRateData true ───────────────────────

describe('rateBadge — defensive: priorRate null with hasRateData true', () => {
  it('falls back to Building history (muted) rather than crashing', () => {
    // This branch should not occur in normal operation, but guards against
    // future callers that pass inconsistent arguments.
    const badge = rateBadge(95, null, true, COMPARE_AY);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });

  it('compareAy null despite hasRateData true → Building history (muted)', () => {
    const badge = rateBadge(95, 90, true, null);
    expect(badge.label).toBe('Building history');
    expect(badge.tone).toBe('muted');
  });
});
