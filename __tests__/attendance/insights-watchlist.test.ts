/**
 * Unit tests for lib/attendance/insights-watchlist.ts
 *
 * Pure logic — no I/O, no mocks. (The A-vs-EX "unexplained absence" helpers
 * were retired — the system records no reason for a plain Absent mark — so only
 * the leave-quota tier remains.)
 */
import { describe, expect, it } from 'vitest';

import { isApproachingVlQuota } from '@/lib/attendance/insights-watchlist';

// ─── isApproachingVlQuota ───────────────────────────────────────────────────

describe('isApproachingVlQuota', () => {
  it('remaining === 0 and not over → approaching', () => {
    expect(isApproachingVlQuota(0, false)).toBe(true);
  });

  it('remaining > 0 → not approaching', () => {
    expect(isApproachingVlQuota(1, false)).toBe(false);
  });

  it('remaining === 0 but isOver → over (not approaching)', () => {
    // isOver means they went past the limit; approaching is pre-breach only
    expect(isApproachingVlQuota(0, true)).toBe(false);
  });

  it('remaining < 0 (over quota) → isApproaching false', () => {
    // remainingThisTerm is max(0, allowance - used) in the rollup, so
    // this should never occur in practice — but we guard defensively.
    expect(isApproachingVlQuota(-1, true)).toBe(false);
  });
});
