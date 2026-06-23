/**
 * Shared helpers for the Insights "comparison AY" feature.
 *
 * Pure — no server-only imports. Safe to import from client components + tests.
 */

/** Sentinel value written to `?compareAy=` when the user explicitly turns
 *  the comparison off. Using a sentinel (instead of deleting the param) lets
 *  the RSC distinguish "user said none" from "param absent → infer the prior". */
export const COMPARE_NONE = 'none';

/**
 * Resolve which AY to compare against.
 *
 * Decision table:
 * - explicit `'none'` sentinel → null  (user turned comparison off)
 * - a valid AY code (present in `ayCodes`, not equal to `selectedAy`) → that AY
 * - absent / invalid / same as selected → inferred prior (next-oldest in list)
 *   preserving the no-regression default for pages not yet wired to the picker
 */
export function resolveCompareAy(
  raw: string | string[] | undefined,
  ayCodes: readonly string[],
  selectedAy: string
): string | null {
  const value = typeof raw === 'string' ? raw : undefined;
  if (value === COMPARE_NONE) return null;
  if (value && ayCodes.includes(value) && value !== selectedAy) return value;
  // Inferred prior: listAyCodes is newest-first, so i+1 is the prior year.
  const i = ayCodes.indexOf(selectedAy);
  return i >= 0 && i + 1 < ayCodes.length ? ayCodes[i + 1] : null;
}

export type ComparisonCardState = 'building' | 'no-data' | 'ok';

/**
 * Decide how a comparison-bearing card section should render.
 *
 * - `compareAy` is `null` (no other AY on record, or user turned it off) → `'building'`
 * - `compareAy` is set but the comparison AY has no usable data → `'no-data'`
 * - otherwise → `'ok'`
 */
export function comparisonCardState(
  compareAy: string | null,
  hasComparisonData: boolean
): ComparisonCardState {
  if (compareAy === null) return 'building';
  return hasComparisonData ? 'ok' : 'no-data';
}
