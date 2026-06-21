// Pure, client-safe staleness helpers for admissions applications.
//
// "Staleness" = how long since an application's record was last touched
// (ay{YY}_enrolment_status.applicationUpdatedDate). This mirrors the bucketing
// in getOutdatedApplications (lib/admissions/dashboard.ts) so the dashboard's
// "Follow up today" list, the outdated drill, and the applications-table
// staleness filter/badge all agree on the same thresholds + vocabulary.
//
// Thresholds match the existing tierFor() in outdated-applications-table.tsx and
// admissions-drill-sheet.tsx: Warning at >= 7 days, Critical at >= 14 days.

export const STALENESS_LABELS = {
  fresh: 'Fresh',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Never updated',
} as const;

export type StalenessLabel =
  (typeof STALENESS_LABELS)[keyof typeof STALENESS_LABELS];

export const STALENESS_WARNING_DAYS = 7;
export const STALENESS_CRITICAL_DAYS = 14;

// Tiers in severity order (most -> least actionable). Drives facet option
// ordering and the column sort comparator.
export const STALENESS_ORDER: StalenessLabel[] = [
  STALENESS_LABELS.critical,
  STALENESS_LABELS.warning,
  STALENESS_LABELS.fresh,
  STALENESS_LABELS.unknown,
];

// The "needs follow-up" tiers (>= 7 days). This is the single vocabulary the
// dashboard "Follow up today" deep-link shares with the applications-table
// staleness facet — import it on both sides so the strings can never drift.
export const STALENESS_FOLLOW_UP_VALUES: StalenessLabel[] = [
  STALENESS_LABELS.warning,
  STALENESS_LABELS.critical,
];

/** Whole days since `applicationUpdatedDate`; null when no/invalid date. */
export function daysSinceUpdate(
  applicationUpdatedDate: string | null | undefined
): number | null {
  if (!applicationUpdatedDate) return null;
  const updated = Date.parse(applicationUpdatedDate);
  if (Number.isNaN(updated)) return null;
  return Math.floor((Date.now() - updated) / 86_400_000);
}

/** Bucket a day-count into a staleness tier label. */
export function stalenessLabel(days: number | null): StalenessLabel {
  if (days === null) return STALENESS_LABELS.unknown;
  if (days >= STALENESS_CRITICAL_DAYS) return STALENESS_LABELS.critical;
  if (days >= STALENESS_WARNING_DAYS) return STALENESS_LABELS.warning;
  return STALENESS_LABELS.fresh;
}

/** Severity rank for sorting (0 = most actionable, higher = less). */
export function stalenessRank(label: StalenessLabel): number {
  const i = STALENESS_ORDER.indexOf(label);
  return i === -1 ? STALENESS_ORDER.length : i;
}
