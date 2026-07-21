export type AyTrendPoint = {
  periodLabel: string;
  ayCode: string;
  value: number | null;
};
export type AyTrendResult = {
  data: Array<Record<string, string | number | null>>;
  series: Array<{ key: string; label: string; muted?: boolean }>;
};

/** One line per AY on a shared relative x-axis. ays[0] = current (solid); rest = muted. */
export function buildAyTrend(
  points: AyTrendPoint[],
  periods: string[],
  ays: string[]
): AyTrendResult {
  const series = ays.map((ayCode, i) => ({
    key: ayCode,
    label: ayCode,
    muted: i > 0,
  }));
  const lookup = new Map<string, number | null>();
  for (const p of points)
    lookup.set(`${p.periodLabel}\x00${p.ayCode}`, p.value);
  const data = periods.map((period) => {
    const row: Record<string, string | number | null> = { x: period };
    for (const ay of ays) {
      const k = `${period}\x00${ay}`;
      row[ay] = lookup.has(k) ? (lookup.get(k) ?? null) : null;
    }
    return row;
  });
  return { data, series };
}

/** Extracts the current-AY (series[0], always the solid/primary series) line
 * from an AyTrendResult as sparkline points, dropping null (future/
 * un-encoded) periods so a MetricCard sparkline doesn't flatline toward
 * zero. Returned shape structurally matches SparkPoint
 * (components/dashboard/charts/sparkline-chart) without importing it, so
 * this pure lib module has no dependency on the component layer. */
export function sparklineFromAyTrend(
  trend: AyTrendResult
): Array<{ x: string; y: number }> {
  const currentKey = trend.series[0]?.key;
  if (!currentKey) return [];
  const points: Array<{ x: string; y: number }> = [];
  for (const row of trend.data) {
    const x = row.x;
    const y = row[currentKey];
    if (typeof x === 'string' && typeof y === 'number') {
      points.push({ x, y });
    }
  }
  return points;
}
