'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';

import { formatterFor, type YFormat } from './chart-primitives';

export type { YFormat };

export type GroupedBarSeries = {
  key: string;
  label: string;
  /** Explicit CSS colour (e.g. `var(--color-chart-3)`) — overrides the auto-cycled palette. */
  color?: string;
  /**
   * Muted series (typically a prior-year comparison overlay) render in neutral
   * grey so it reads unmistakably as "not this year" — never another shade of
   * the accent blue.
   */
  muted?: boolean;
};

export type GroupedBarChartProps = {
  /** Each series maps to one bar per category, grouped side by side (never stacked). */
  series: GroupedBarSeries[];
  /** Each object has 'x' (category label) + one numeric key per series. */
  data: Array<Record<string, string | number | null>>;
  height?: number;
  yFormat?: YFormat;
  /** Fixed Y domain e.g. [80, 100] for rate charts. */
  yDomain?: [number, number];
};

// Non-muted series cycle through the chart palette; a muted series (the
// comparison-year overlay) always renders grey regardless of position, so it
// never competes with the palette used for "real" series (e.g. Markbook's
// per-subject bars).
const SERIES_COLOR_VARS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];
const SERIES_LEGEND_COLORS: ChartLegendChipColor[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
];
const MUTED_COLOR_VAR = 'var(--color-muted-foreground)';
const MUTED_LEGEND_COLOR: ChartLegendChipColor = 'neutral';

/** Resolve one render colour + one legend-chip colour per series, in order. */
function resolvePalette(series: GroupedBarSeries[]) {
  let cursor = 0;
  const fill: string[] = [];
  const legend: ChartLegendChipColor[] = [];
  for (const s of series) {
    if (s.muted) {
      fill.push(MUTED_COLOR_VAR);
      legend.push(MUTED_LEGEND_COLOR);
      continue;
    }
    if (s.color) {
      fill.push(s.color);
      // No token name for a caller-supplied colour — fall back to cycling the
      // legend chip so it still reads distinctly from its neighbours.
      legend.push(SERIES_LEGEND_COLORS[cursor % SERIES_LEGEND_COLORS.length]);
      cursor += 1;
      continue;
    }
    fill.push(SERIES_COLOR_VARS[cursor % SERIES_COLOR_VARS.length]);
    legend.push(SERIES_LEGEND_COLORS[cursor % SERIES_LEGEND_COLORS.length]);
    cursor += 1;
  }
  return { fill, legend };
}

function GroupedBarChartImpl({
  series,
  data,
  height = 260,
  yFormat,
  yDomain,
}: GroupedBarChartProps) {
  const yFormatter = formatterFor(yFormat);
  const { fill, legend } = resolvePalette(series);

  const legendPalette: Record<string, ChartLegendChipColor> = {};
  series.forEach((s, i) => {
    legendPalette[s.key] = legend[i];
  });

  if (data.length === 0 || series.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
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
          dataKey="x"
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter}
          domain={yDomain}
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
        <Legend content={chartLegendContent(legendPalette)} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={fill[i]}
            maxBarSize={40}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const GroupedBarChart = React.memo(GroupedBarChartImpl);
GroupedBarChart.displayName = 'GroupedBarChart';
