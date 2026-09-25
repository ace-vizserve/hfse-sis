'use client';

import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import {
  ACTIVE_DOT,
  LINE_CURSOR,
  LINE_WIDTH,
} from '@/components/dashboard/charts/chart-primitives';
import { chartTooltipContent } from '@/components/dashboard/charts/chart-tooltip';
import {
  formatMetricValue,
  type MetricFormat,
} from '@/lib/dashboard/format-metric';

export type SparkPoint = { x: string; y: number };

/**
 * The trend line inside a `MetricCard`.
 *
 * It was the only recharts chart in the SIS with no `<Tooltip>` at all, so
 * hovering the line under a KPI returned nothing — not the period, not the
 * value. The points are already labelled (`x`), so the data to answer both was
 * there the whole time; nothing rendered it.
 *
 * `XAxis` is present but `hide`-den purely so recharts resolves `x` as the
 * tooltip's label. Without it the heading would be the array index.
 */
function SparklineChartImpl({
  points,
  seriesName = 'Value',
  format,
  currencySuffix,
}: {
  points: SparkPoint[];
  /** What one y value is, shown beside the number. */
  seriesName?: string;
  /**
   * The format NAME, not a formatter — a function cannot be passed from a
   * server component (which `MetricCard` is) into a client one. The closure is
   * rebuilt here so the readout matches the card's headline units.
   */
  format?: MetricFormat;
  currencySuffix?: string;
}) {
  const formatValue = React.useCallback(
    (n: number) => formatMetricValue(n, format, currencySuffix),
    [format, currencySuffix]
  );
  const gradientId = `spark-${points.length}-${points[0]?.x ?? 'n'}`;
  const lastIndex = points.length - 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={points}
        // Room for the latest point's dot, which sits on the right edge.
        margin={{ top: 5, right: 5, left: 1, bottom: 1 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-series-1)"
              stopOpacity={0.16}
            />
            <stop
              offset="100%"
              stopColor="var(--color-series-1)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <XAxis dataKey="x" hide />
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          // The crosshair finds the period — on a 40px-tall line nobody can
          // aim at a 2px stroke.
          cursor={LINE_CURSOR}
          content={chartTooltipContent({ format: formatValue })}
          // The card itself is short; keep the box clear of the value above it.
          allowEscapeViewBox={{ x: false, y: true }}
        />
        <Area
          type="monotone"
          dataKey="y"
          name={seriesName}
          stroke="var(--color-series-1)"
          strokeWidth={LINE_WIDTH}
          fill={`url(#${gradientId})`}
          // Only the latest point is marked: it is the one the headline
          // figure above the line reports.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dot={(p: any) =>
            p.index === lastIndex ? (
              <circle
                key="latest"
                cx={p.cx}
                cy={p.cy}
                r={3.5}
                fill="var(--color-series-1)"
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            ) : (
              <g key={p.index} />
            )
          }
          activeDot={{ ...ACTIVE_DOT, fill: 'var(--color-series-1)' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const SparklineChart = React.memo(SparklineChartImpl);
SparklineChart.displayName = 'SparklineChart';
