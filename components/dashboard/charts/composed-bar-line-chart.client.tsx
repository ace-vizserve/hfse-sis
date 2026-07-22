'use client';

import * as React from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';

import { formatterFor, type YFormat } from './chart-primitives';

export type { YFormat };

/**
 * Current-period BARS with a comparison-period LINE overlaid on the same axis.
 * Both series must share one unit + scale (e.g. two years of the same count) —
 * the line is a reference curve traced over the bars, NOT a second metric on a
 * hidden secondary axis. Categories should be an ordered sequence (e.g. grade
 * levels P1→S4) so the line reads as a real shape, not a zig-zag between
 * unrelated buckets. The comparison line renders in muted grey (the app-wide
 * "prior period" convention) so it never competes with the current bars.
 */

export type ComposedBarLinePoint = {
  category: string;
  bar: number;
  line: number | null;
};

export type ComposedBarLineChartProps = {
  data: ComposedBarLinePoint[];
  barLabel: string;
  lineLabel: string;
  height?: number;
  yFormat?: YFormat;
};

function ComposedBarLineChartImpl({
  data,
  barLabel,
  lineLabel,
  height = 300,
  yFormat,
}: ComposedBarLineChartProps) {
  const yFormatter = formatterFor(yFormat);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="24%"
      >
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
          opacity={0.6}
        />
        <XAxis
          dataKey="category"
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-accent)', opacity: 0.5 }}
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
        <Legend
          content={chartLegendContent({
            [barLabel]: 'chart-1',
            [lineLabel]: 'neutral',
          })}
        />
        <Bar
          dataKey="bar"
          name={barLabel}
          fill="var(--color-chart-1)"
          maxBarSize={40}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          dataKey="line"
          name={lineLabel}
          type="monotone"
          stroke="var(--color-muted-foreground)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: 'var(--color-muted-foreground)' }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export const ComposedBarLineChart = React.memo(ComposedBarLineChartImpl);
ComposedBarLineChart.displayName = 'ComposedBarLineChart';
