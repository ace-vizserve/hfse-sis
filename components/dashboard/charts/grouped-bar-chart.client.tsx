'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';

import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  MUTED_SERIES,
  SERIES_COLORS,
  SERIES_LEGEND,
  VALUE_LABEL,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

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
  /** Print each bar's value above it, formatted via `yFormat`. */
  showValueLabels?: boolean;
  /** The `x` category to visually emphasize (e.g. the current/latest
   *  period) — its bars render at full opacity, all others dimmed. Unset
   *  leaves every bar at its normal series fill (no behavior change). */
  highlightX?: string;
};

// Non-muted series cycle through the chart palette; a muted series (the
// comparison-year overlay) always renders grey regardless of position, so it
// never competes with the palette used for "real" series (e.g. Markbook's
// per-subject bars).
const SERIES_COLOR_VARS: readonly string[] = SERIES_COLORS;
const SERIES_LEGEND_COLORS = SERIES_LEGEND;
const MUTED_COLOR_VAR = MUTED_SERIES;
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
  showValueLabels,
  highlightX,
}: GroupedBarChartProps) {
  const yFormatter = formatterFor(yFormat);
  const { fill, legend } = resolvePalette(series);
  const labelFormatter = (label: unknown) => {
    const v = typeof label === 'number' ? label : Number(label);
    if (label == null || !Number.isFinite(v)) return '';
    return yFormatter ? yFormatter(v) : String(v);
  };

  const legendPalette: Record<string, ChartLegendChipColor> = {};
  series.forEach((s, i) => {
    legendPalette[s.key] = legend[i];
  });

  if (data.length === 0 || series.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: showValueLabels ? 20 : 8, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="24%"
        // Bars in one group sit 2px apart rather than touching.
        barGap={2}
      >
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          dataKey="x"
          tick={CATEGORY_TICK}
          {...CHART_AXIS}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={AXIS_TICK}
          {...CHART_AXIS}
          tickFormatter={yFormatter}
          domain={yDomain}
          width={36}
        />
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={BAR_CURSOR}
          // Grouped, never stacked: the series sit beside each other and often
          // carry rates, so no share and no total — summing them is meaningless.
          content={chartTooltipContent({ format: yFormatter })}
        />
        <Legend content={chartLegendContent(legendPalette)} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={fill[i]}
            maxBarSize={40}
            radius={BAR_RADIUS_TOP}
            isAnimationActive={false}
          >
            {highlightX &&
              data.map((row, ri) => (
                <Cell
                  key={ri}
                  fill={fill[i]}
                  fillOpacity={row.x === highlightX ? 1 : 0.45}
                />
              ))}
            {showValueLabels && (
              <LabelList
                dataKey={s.key}
                position="top"
                offset={8}
                formatter={labelFormatter}
                style={VALUE_LABEL}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const GroupedBarChart = React.memo(GroupedBarChartImpl);
GroupedBarChart.displayName = 'GroupedBarChart';
