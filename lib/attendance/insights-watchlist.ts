/**
 * Pure helpers for the Attendance Insights leave-quota tiers.
 *
 * Kept pure (no I/O) so they are unit-testable without DB mocks.
 *
 * NOTE: the old A-vs-EX "unexplained absence" / truancy-watchlist helpers
 * (`computeAbsenceMix`, `splitWatchlist`) were removed — the system records no
 * reason for a plain `Absent` (A) mark, so labelling it "unexplained" and
 * inferring truancy overclaimed what the data supports (an A just means "not
 * marked as an excused leave"). The Insights page now ranks students by raw
 * absence count instead, and states no reason it can't know. Excused leaves
 * (EX) ARE reason-tracked (MC / vacation / compassionate, KD #94), which is
 * what the quota tiers below still key on.
 */

// ─── Quota approaching tier ──────────────────────────────────────────────────

/**
 * Returns true when a student has used their full allowance this term but is
 * not formally over quota (i.e. `remaining === 0`). Used by the vacation-leave
 * approaching tier to surface pre-breach warnings.
 *
 * For compassionate leave, `remaining` maps to `allowance - used`.
 * For vacation leave, `remaining` maps to `remainingThisTerm`.
 */
export function isAtQuota(remaining: number, isOver: boolean): boolean {
  return !isOver && remaining === 0;
}

/**
 * Approaching tier: used up their allowance this term but not formally over
 * (remaining === 0). For vacation leave only — compassionate at-quota is less
 * actionable (per-year, so being at 5/5 at T2 is fine; only >5 is the signal).
 */
export function isApproachingVlQuota(
  remainingThisTerm: number,
  isOverTermQuota: boolean
): boolean {
  return isAtQuota(remainingThisTerm, isOverTermQuota);
}
