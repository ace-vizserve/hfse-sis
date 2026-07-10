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

// ── summariseSeriesMovement ─────────────────────────────────────────────────

export type SeriesMovementPoint = {
  /** Period label on the X axis (e.g. 'T1', 'Jul'). */
  x: string;
  value: number | null;
};

export type SeriesMovementSummary = {
  /** The period the headline anchors to (latest with data). Null = no data. */
  periodLabel: string | null;
  currentValue: number | null;
  /**
   * First→latest movement within the one series, ready for TrendDeltaCaption.
   * Null when fewer than 2 data points exist (single point or empty) — the
   * first and latest period would be the same, so there is no movement to
   * report and none is fabricated.
   */
  delta: { label: string; direction: TrendDeltaDirection } | null;
};

/**
 * Summarise a SINGLE series into a headline value + first→latest delta for
 * the Insights "Trend" caption. The within-AY sibling of `summariseAyTrend`:
 * that helper compares a current series against a muted comparison series at
 * the same period; this one measures how far one series moved from its FIRST
 * period with data to its LATEST period with data (leading/trailing nulls
 * skipped). The label reads plainly, e.g. "+3.3 vs T1".
 */
export function summariseSeriesMovement(
  points: SeriesMovementPoint[]
): SeriesMovementSummary {
  const withData = points.filter((p) => typeof p.value === 'number');

  if (withData.length === 0) {
    return { periodLabel: null, currentValue: null, delta: null };
  }

  const latest = withData[withData.length - 1];
  if (withData.length === 1) {
    return {
      periodLabel: latest.x,
      currentValue: latest.value,
      delta: null,
    };
  }

  const first = withData[0];
  const abs =
    Math.round(((latest.value as number) - (first.value as number)) * 10) / 10;
  const direction: TrendDeltaDirection =
    abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';

  return {
    periodLabel: latest.x,
    currentValue: latest.value,
    delta: {
      label: `${abs >= 0 ? '+' : ''}${abs} vs ${first.x}`,
      direction,
    },
  };
}
