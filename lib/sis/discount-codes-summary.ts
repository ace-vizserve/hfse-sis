// Tallies the SAME classifyCodeStatus the table's per-row badges already
// use (components/ui/discount-code-status-badge.tsx) — the page's summary
// tiles previously hand-rolled a separate date-comparison loop that never
// produced an "inactive" bucket, so the two could disagree.

export type DiscountCodeStatus =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'inactive';

export function summarizeDiscountCodeStatuses<T>(
  codes: T[],
  classify: (start: string | null, end: string | null) => DiscountCodeStatus
): Record<DiscountCodeStatus, number> {
  const counts: Record<DiscountCodeStatus, number> = {
    active: 0,
    scheduled: 0,
    expired: 0,
    inactive: 0,
  };
  for (const c of codes as unknown as Array<{
    startDate: string | null;
    endDate: string | null;
  }>) {
    counts[classify(c.startDate, c.endDate)] += 1;
  }
  return counts;
}
