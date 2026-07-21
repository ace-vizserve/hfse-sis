/**
 * Shared colour-token map + pure logic helpers for the bento Insights
 * primitive library (`components/dashboard/insights/bento/`). Every other
 * file in this folder imports `ColorKey` and the gradient maps from here so
 * a segment/tile/bar-fill and its legend swatch can never drift (design
 * system §10.2 — single source of truth for a colour and its legend key).
 *
 * Hard Rule #7: every class below resolves to a token registered in
 * `app/globals.css`'s `@theme inline` block — no raw hex/oklch/slate/zinc/
 * gray anywhere in this file.
 */

export type ColorKey =
  | 'indigo'
  | 'mint'
  | 'sky'
  | 'amber'
  | 'destructive'
  | 'grey';

/**
 * Gradient icon-tile classes (bg + text + shadow), diagonal (`to-br`) —
 * the app's canonical "icon tiles are crafted, not flat" recipe
 * (docs/context/09a-design-patterns.md §7.4).
 */
export const TILE_GRADIENT: Record<ColorKey, string> = {
  indigo:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  mint: 'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  // No shadow-brand-tile-sky token exists; reusing the indigo tile shadow for
  // sky tiles is the established precedent elsewhere in the codebase (see
  // components/attendance/drills/vacation-leave-quota-card.tsx).
  sky: 'bg-gradient-to-br from-brand-sky to-brand-indigo text-white shadow-brand-tile',
  amber:
    'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  destructive:
    'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  // Neutral/comparison tile (e.g. a "prior AY" row beside the current one) —
  // ink-4/ink-5 are the exact hex the locked mockups used for their own grey
  // tiles (#64748B / #94A3B8), so this is a literal, not approximate, match.
  grey: 'bg-gradient-to-br from-ink-5 to-ink-4 text-white shadow-brand-tile',
};

/** Horizontal bar-fill gradient — segmented-bar segments, ranked-bar fills, bar-stack bars. */
export const BAR_GRADIENT: Record<ColorKey, string> = {
  indigo: 'bg-gradient-to-r from-brand-indigo-light to-brand-indigo',
  mint: 'bg-gradient-to-r from-brand-mint to-brand-sky',
  sky: 'bg-gradient-to-r from-brand-sky to-brand-indigo',
  amber: 'bg-gradient-to-r from-brand-amber-light to-brand-amber',
  destructive: 'bg-gradient-to-r from-destructive to-destructive/80',
  grey: 'bg-gradient-to-r from-ink-5 to-ink-4',
};

/** Small legend dot/swatch — diagonal, same finish as `ChartLegendChip` (§10.1: legend swatch paint must match the thing it documents). */
export const DOT_GRADIENT: Record<ColorKey, string> = {
  indigo: 'bg-gradient-to-br from-brand-indigo-light to-brand-indigo',
  mint: 'bg-gradient-to-br from-brand-mint to-brand-sky',
  sky: 'bg-gradient-to-br from-brand-sky to-brand-indigo',
  amber: 'bg-gradient-to-br from-brand-amber-light to-brand-amber',
  destructive: 'bg-gradient-to-br from-destructive to-destructive/80',
  grey: 'bg-gradient-to-br from-ink-5 to-ink-4',
};

/** SVG stroke colour class — rate-dial tick marks. */
export const STROKE_CLASS: Record<ColorKey, string> = {
  indigo: 'stroke-brand-indigo',
  mint: 'stroke-brand-mint',
  sky: 'stroke-brand-sky',
  amber: 'stroke-brand-amber',
  destructive: 'stroke-destructive',
  grey: 'stroke-ink-4',
};

/**
 * Soft-tint badge/pill classes (border + light gradient wash + text) — the
 * same tonal recipe as the app's existing status-badge conventions
 * (docs/context/09a-design-patterns.md §9.3), generalised across all 6
 * ColorKeys instead of just healthy/blocked. Used by badge-tooltip and any
 * other pill that needs a colour-coded-but-not-saturated treatment.
 */
export const SOFT_BADGE_CLASS: Record<ColorKey, string> = {
  indigo:
    'border-brand-indigo/30 bg-gradient-to-b from-brand-indigo/15 to-brand-indigo/5 text-brand-indigo-deep',
  mint: 'border-brand-mint/60 bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink',
  sky: 'border-brand-sky/40 bg-gradient-to-b from-brand-sky/20 to-brand-sky/5 text-ink',
  amber:
    'border-brand-amber/40 bg-gradient-to-b from-brand-amber/28 to-brand-amber/8 text-ink',
  destructive:
    'border-destructive/40 bg-gradient-to-b from-destructive/20 to-destructive/6 text-destructive',
  grey: 'border-hairline-strong bg-muted text-muted-foreground',
};

/** Delta-direction pill classes shared by stat-card and bar-stack's optional headline delta — aliases of the mint/destructive soft badges. */
export type DeltaDirection = 'up' | 'down';
export const DELTA_PILL_CLASS: Record<DeltaDirection, string> = {
  up: SOFT_BADGE_CLASS.mint,
  down: SOFT_BADGE_CLASS.destructive,
};

/**
 * Ordinal quality ramp — destructive (worst) → amber → sky → mint (best) —
 * for ranked-bar / segmented-bar fills scored against a 0–100-ish scale
 * (conversion %, retention %, attendance %, subject average).
 *
 * Two thresholds define 4 bins: below `low` is destructive, from `low` up to
 * the low/high midpoint is amber, from the midpoint up to `high` is sky, and
 * `high` and above is mint. All three cut points (`low`, the midpoint,
 * `high`) are inclusive on their upper bin.
 *
 * The midpoint-as-third-boundary is a deliberate simplification: the locked
 * mockups (insights-mockup-{admissions,records}.html) hand-picked slightly
 * different amber/sky/mint cut points per page rather than following one
 * universal formula, so there's nothing single to reverse-engineer — this
 * picks one honest, monotonic, easy-to-reason-about rule and documents it
 * here as the actual contract callers can rely on.
 */
export function qualityRampColorKey(
  value: number,
  thresholds: { low: number; high: number }
): ColorKey {
  const { low, high } = thresholds;
  const mid = (low + high) / 2;
  if (value < low) return 'destructive';
  if (value < mid) return 'amber';
  if (value < high) return 'sky';
  return 'mint';
}
