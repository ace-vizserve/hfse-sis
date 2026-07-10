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

import { formatterFor, type YFormat } from './chart-primitives';

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

const CURRENT_COLOR = 'var(--color-chart-1)';
const COMPARISON_COLOR = 'var(--color-muted-foreground)';

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
    legendPalette[s.key] = s.muted ? 'neutral' : 'chart-1';
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
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
          opacity={0.6}
        />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter}
          domain={yDomain}
          width={36}
        />
        {showZeroLine && (
          <ReferenceLine y={0} stroke="var(--color-border)" strokeWidth={1.4} />
        )}
        <Tooltip
          cursor={{
            stroke: 'var(--color-muted-foreground)',
            strokeDasharray: '3 3',
          }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 11,
            padding: '8px 10px',
          }}
          labelStyle={{
            color: 'var(--color-foreground)',
            fontWeight: 600,
            marginBottom: 2,
          }}
          formatter={(value) => {
            const v = typeof value === 'number' ? value : Number(value);
            return yFormatter ? yFormatter(v) : v;
          }}
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
              strokeWidth={isCurrent ? 2.6 : 2}
              strokeDasharray={isCurrent ? undefined : '6 5'}
              fill={isCurrent ? `url(#${gradientId})` : 'transparent'}
              dot={{
                r: isCurrent ? 3 : 2.4,
                fill: 'var(--color-background)',
                stroke: isCurrent ? CURRENT_COLOR : COMPARISON_COLOR,
                strokeWidth: isCurrent ? 2 : 1.6,
              }}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: 'var(--color-background)',
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
