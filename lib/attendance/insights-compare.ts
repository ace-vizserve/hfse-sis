/**
 * Pure helpers for the Attendance Insights page comparison logic.
 *
 * Extracted so the hero badge and Section-1 card use the identical signal,
 * and the decision is independently unit-testable (no Next.js / Supabase
 * imports — safe in any environment).
 */

export type BadgeTone = 'muted' | 'mint' | 'amber';

export interface RateBadge {
  label: string;
  tone: BadgeTone;
}

/**
 * Produce the hero badge for the Attendance Insights rate comparison.
 *
 * Decision table (mirrors `comparisonCardState` + Section-1 card logic):
 *
 * - `hasRateData` is false (no comparison AY, or that AY has zero encoded
 *   days) → `{ label: 'Building history', tone: 'muted' }`
 * - `hasRateData` is true and rate >= priorRate → mint "rate% vs prior% in AY"
 * - `hasRateData` is true and rate <  priorRate → amber "rate% vs prior% in AY"
 *
 * `priorRate` MUST be non-null when `hasRateData` is true (the caller already
 * guarantees this — `priorRate` is derived from `priorKpis` which is non-null
 * exactly when `compareAy` is set, and `hasRateData` additionally requires
 * `encodedDays > 0`). If `priorRate` is null despite `hasRateData` being true
 * (defensive branch only), we fall back to the building-history badge.
 */
export function rateBadge(
  rate: number,
  priorRate: number | null,
  hasRateData: boolean,
  compareAy: string | null
): RateBadge {
  if (!hasRateData || priorRate === null || compareAy === null) {
    return { label: 'Building history', tone: 'muted' };
  }
  return {
    label: `${rate}% vs ${priorRate}% in ${compareAy}`,
    tone: rate >= priorRate ? 'mint' : 'amber',
  };
}
