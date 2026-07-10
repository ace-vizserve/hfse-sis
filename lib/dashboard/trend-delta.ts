import { growthDelta } from './growth';

/**
 * Summarise a `buildAyTrend()`/`buildMultiAyTrend()`-shaped result into a
 * headline value + delta for the Insights "Trend" section caption.
 *
 * Anchoring rule: the comparison is always taken at the SAME period index as
 * the current series' latest non-null value (not each series' own latest
 * point) — otherwise a comparison AY with more completed periods than the
 * current one could compare e.g. this-year-T3 against last-year-T4, which
 * would misleadingly attribute a full extra period's movement to "growth."
 */

export type TrendDeltaDirection = 'up' | 'down' | 'flat';

export type TrendDeltaSummary = {
  /** The period the headline is anchored to (e.g. 'T3', 'Jul'). Null = no current data. */
  periodLabel: string | null;
  currentValue: number | null;
  comparisonValue: number | null;
  comparisonLabel: string | null;
  /** Null when there's no comparison series, or no comparison value at the anchor period. */
  delta: {
    /** Percent growth vs the comparison value; null when the comparison value is 0 (avoid /0, KD honesty). */
    pct: number | null;
    /** Raw difference (current − comparison), same unit as the plotted values. */
    abs: number;
    direction: TrendDeltaDirection;
  } | null;
};

export function summariseAyTrend(
  data: Array<Record<string, string | number | null>>,
  series: Array<{ key: string; label: string; muted?: boolean }>
): TrendDeltaSummary {
  const current = series.find((s) => !s.muted);
  const comparison = series.find((s) => s.muted);

  if (!current) {
    return {
      periodLabel: null,
      currentValue: null,
      comparisonValue: null,
      comparisonLabel: comparison?.label ?? null,
      delta: null,
    };
  }

  let anchorIdx = -1;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const v = data[i][current.key];
    if (typeof v === 'number') {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx === -1) {
    return {
      periodLabel: null,
      currentValue: null,
      comparisonValue: null,
      comparisonLabel: comparison?.label ?? null,
      delta: null,
    };
  }

  const periodLabel = String(data[anchorIdx].x);
  const currentValue = data[anchorIdx][current.key] as number;
  const comparisonRaw = comparison ? data[anchorIdx][comparison.key] : null;
  const comparisonValue =
    typeof comparisonRaw === 'number' ? comparisonRaw : null;

  if (comparisonValue === null) {
    return {
      periodLabel,
      currentValue,
      comparisonValue: null,
      comparisonLabel: comparison?.label ?? null,
      delta: null,
    };
  }

  const growth = growthDelta(currentValue, comparisonValue);
  const abs = Math.round((currentValue - comparisonValue) * 100) / 100;
  const direction: TrendDeltaDirection =
    abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';

  return {
    periodLabel,
    currentValue,
    comparisonValue,
    comparisonLabel: comparison?.label ?? null,
    delta: { pct: growth.pct, abs, direction },
  };
}
