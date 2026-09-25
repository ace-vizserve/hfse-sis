/**
 * Shared primitives for the recharts chart wrappers under this folder.
 *
 * Every chart (trend line, multi-series line, grouped bar, AY-comparison
 * area) formats its Y axis / tooltip values the same way — this is the
 * single source so the four near-identical copies don't drift.
 */

import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';

export type YFormat = 'number' | 'percent' | 'days';

export function formatterFor(
  format: YFormat | undefined
): ((n: number) => string) | undefined {
  switch (format) {
    case 'percent':
      return (n) => `${Math.round(n)}%`;
    case 'days':
      return (n) => `${Math.round(n)}d`;
    case 'number':
      return (n) => n.toLocaleString('en-SG');
    default:
      return undefined;
  }
}

// ─── THE SHARED CHART STYLE ──────────────────────────────────────────────
//
// Recharts has no theme or config file: every chart styles itself through
// props on each child. Before 2026-09-25 each chart carried its own copy of
// those props and they had drifted (grid dashes `2 4` in some, `3 3` in
// others; `var(--border)` in some, `var(--color-border)` in others). These
// constants are the one copy. A chart spreads them onto its children —
// `<CartesianGrid {...CHART_GRID} />` — because recharts reads its pieces as
// direct children, so a wrapper component would not be recognised.
//
// Approved from the admissions chart mockup (Mr Ace, 2026-09-25). Design only:
// no chart's data, query, drill or click changes with any of this.

/** Series colours in fixed order — a series keeps its colour across filters. */
export const SERIES_COLORS = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
] as const;

/** The legend-chip names for the same five, in the same order. */
export const SERIES_LEGEND: ChartLegendChipColor[] = [
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
];

/**
 * An earlier period drawn beside this one. Grey, so this year always reads
 * first and the comparison never looks like a second real series.
 */
export const MUTED_SERIES = 'var(--color-ink-5)';

/** Quiet frame: faint, solid, horizontal only. */
export const CHART_GRID = {
  stroke: 'var(--color-border)',
  strokeOpacity: 0.75,
  vertical: false,
} as const;

/** No axis lines or tick marks — the grid and the labels carry the scale. */
export const CHART_AXIS = { tickLine: false, axisLine: false } as const;

/** Numeric tick labels: small mono, muted. */
export const AXIS_TICK = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--color-muted-foreground)',
} as const;

/** Category tick labels (levels, stages): a touch larger and darker. */
export const CATEGORY_TICK = {
  fontSize: 11,
  fill: 'var(--color-ink-2)',
} as const;

/** Bars: 4px-rounded at the data end, square on the baseline. */
export const BAR_RADIUS_TOP: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_END: [number, number, number, number] = [0, 4, 4, 0];

/**
 * A 2px card-coloured edge on every stacked segment and pie slice, which
 * reads as a gap between neighbours without changing any bar's geometry.
 */
export const SEGMENT_EDGE = {
  stroke: 'var(--color-card)',
  strokeWidth: 2,
} as const;

export const LINE_WIDTH = 2;

/** Hover highlight behind a bar category. */
export const BAR_CURSOR = { fill: 'var(--color-accent)', opacity: 0.45 };

/** Hover crosshair on a line or area. */
export const LINE_CURSOR = { stroke: 'var(--color-ink-5)', strokeWidth: 1 };

/** The point under the pointer on a line: filled, with a card-coloured ring. */
export const ACTIVE_DOT = {
  r: 4,
  strokeWidth: 2,
  stroke: 'var(--color-card)',
} as const;

/** A value printed on the chart itself. */
export const VALUE_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
  fill: 'var(--color-ink-2)',
} as const;
