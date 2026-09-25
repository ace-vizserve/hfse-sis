'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';

import {
  ACTIVE_DOT,
  AXIS_TICK,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  LINE_CURSOR,
  LINE_WIDTH,
  MUTED_SERIES,
  SERIES_COLORS,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

export type { YFormat };

export type AyComparisonSeries = {
  key: string;
  label: string;
  /**
   * The prior-year overlay. Renders dashed neutral grey — never another
   * shade of the accent blue — so "this year" vs "last year" never depends
   * on the reader spotting a faint dash between two similar hues.
   */
  muted?: boolean;
};

export type AyComparisonLineChartProps = {
  /** series[] follows buildAyTrend's contract: one non-muted "current" entry, 0+ muted comparisons. */
  series: AyComparisonSeries[];
  /** Each object has 'x' (period label) + one numeric key per series. */
  data: Array<Record<string, string | number | null>>;
  height?: number;
  yFormat?: YFormat;
  /** Fixed Y domain e.g. [0, 100]. */
  yDomain?: [number, number];
};

const CURRENT_COLOR = SERIES_COLORS[0];
const COMPARISON_COLOR = MUTED_SERIES;

/** Last non-null point for a series — where its endpoint label anchors. */
function lastPoint(
  data: AyComparisonLineChartProps['data'],
  key: string
): { x: string; y: number } | null {
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const v = data[i][key];
    if (typeof v === 'number') return { x: String(data[i].x), y: v };
  }
  return null;
}

/** True when the plotted values straddle zero (e.g. net enrolment movement). */
function crossesZero(
  data: AyComparisonLineChartProps['data'],
  series: AyComparisonSeries[]
): boolean {
  let sawNeg = false;
  let sawPos = false;
  for (const row of data) {
    for (const s of series) {
      const v = row[s.key];
      if (typeof v !== 'number') continue;
      if (v < 0) sawNeg = true;
      if (v > 0) sawPos = true;
    }
  }
  return sawNeg && sawPos;
}

function AyComparisonLineChartImpl({
  series,
  data,
  height = 240,
  yFormat,
  yDomain,
}: AyComparisonLineChartProps) {
  const gradientId = React.useId();
  const yFormatter = formatterFor(yFormat);

  if (data.length === 0 || series.length === 0) return null;

  const showZeroLine = crossesZero(data, series);
  const legendPalette: Record<string, ChartLegendChipColor> = {};
  series.forEach((s) => {
    legendPalette[s.key] = s.muted ? 'neutral' : 'series-1';
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 54, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CURRENT_COLOR} stopOpacity={0.24} />
            <stop offset="100%" stopColor={CURRENT_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          dataKey="x"
          tick={CATEGORY_TICK}
          {...CHART_AXIS}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tick={AXIS_TICK}
          {...CHART_AXIS}
          tickFormatter={yFormatter}
          domain={yDomain}
          width={36}
        />
        {showZeroLine && (
          <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.4} />
        )}
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={LINE_CURSOR}
          // No share/total: this year and last year are separate series, and
          // adding two years' figures together means nothing.
          content={chartTooltipContent({ format: yFormatter })}
        />
        <Legend content={chartLegendContent(legendPalette)} />
        {series.map((s) => {
          const isCurrent = !s.muted;
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={isCurrent ? CURRENT_COLOR : COMPARISON_COLOR}
              strokeWidth={LINE_WIDTH}
              strokeDasharray={isCurrent ? undefined : '4 4'}
              fill={isCurrent ? `url(#${gradientId})` : 'transparent'}
              dot={{
                r: isCurrent ? 3 : 2.4,
                fill: 'var(--color-card)',
                stroke: isCurrent ? CURRENT_COLOR : COMPARISON_COLOR,
                strokeWidth: isCurrent ? 2 : 1.6,
              }}
              activeDot={{
                ...ACTIVE_DOT,
                fill: isCurrent ? CURRENT_COLOR : COMPARISON_COLOR,
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
          );
        })}
        {series.map((s) => {
          const point = lastPoint(data, s.key);
          if (!point) return null;
          const isCurrent = !s.muted;
          return (
            <ReferenceDot
              key={`${s.key}-endpoint`}
              x={point.x}
              y={point.y}
              r={0}
              ifOverflow="extendDomain"
              label={{
                value: s.label,
                position: 'right',
                offset: 8,
                fill: isCurrent ? CURRENT_COLOR : COMPARISON_COLOR,
                fontSize: 10.5,
                fontWeight: isCurrent ? 700 : 600,
              }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const AyComparisonLineChart = React.memo(AyComparisonLineChartImpl);
AyComparisonLineChart.displayName = 'AyComparisonLineChart';
