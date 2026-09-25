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

import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_END,
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  SEGMENT_EDGE,
  SERIES_COLORS,
  SERIES_LEGEND,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

export type AttritionStackedBarPoint = {
  level: string;
  [reasonKey: string]: string | number;
};

export type AttritionStackedBarChartProps = {
  data: AttritionStackedBarPoint[];
  reasonKeys: string[];
  height?: number;
};

// Palette — reason segments cycle through the series colours.
// Controllable reasons (financial/disciplinary/academic_fit) surface first in
// the legend because they're the ones the registrar can act on; unspecified
// last. The colour ordering follows the same cycle as the donut chart so the
// two views are visually consistent within the Attrition section.
// The sixth and seventh were red and grey by position only — a reason is an
// identity, not a status — so they follow the donut's greys instead. Both
// greys share the one grey legend chip.
const REASON_COLORS: ChartLegendChipColor[] = [
  ...SERIES_LEGEND,
  'neutral',
  'neutral',
];

// CSS var equivalents for recharts fill (can't use Tailwind here).
const REASON_COLOR_VARS = [
  ...SERIES_COLORS,
  'var(--color-ink-4)',
  'var(--color-ink-5)',
];

function AttritionStackedBarChartImpl({
  data,
  reasonKeys,
  height = 260,
}: AttritionStackedBarChartProps) {
  if (data.length === 0 || reasonKeys.length === 0) return null;

  const legendPalette: Record<string, ChartLegendChipColor> = {};
  reasonKeys.forEach((key, i) => {
    legendPalette[key] = REASON_COLORS[i % REASON_COLORS.length];
  });

  // Orient horizontally when there are many levels so labels are readable.
  const isHorizontal = data.length > 5;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, left: isHorizontal ? 4 : 0, bottom: 0 }}
        barCategoryGap={isHorizontal ? 8 : '20%'}
      >
        {/* Horizontal bars read against the value axis, which runs across, so
            the grid lines run down instead. */}
        <CartesianGrid
          {...CHART_GRID}
          horizontal={!isHorizontal}
          vertical={isHorizontal}
        />
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              allowDecimals={false}
              tick={AXIS_TICK}
              {...CHART_AXIS}
            />
            <YAxis
              type="category"
              dataKey="level"
              tick={CATEGORY_TICK}
              {...CHART_AXIS}
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="level"
              tick={CATEGORY_TICK}
              {...CHART_AXIS}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={56}
            />
            <YAxis
              allowDecimals={false}
              tick={AXIS_TICK}
              {...CHART_AXIS}
              width={28}
            />
          </>
        )}
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={BAR_CURSOR}
          content={chartTooltipContent({
            // The segments of one bar partition that level's withdrawals, so
            // each reason's share of the level is the thing being read.
            share: true,
            totalLabel: 'All reasons at this level',
          })}
        />
        <Legend content={chartLegendContent(legendPalette)} />
        {reasonKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={key}
            stackId="reasons"
            fill={REASON_COLOR_VARS[i % REASON_COLOR_VARS.length]}
            {...SEGMENT_EDGE}
            maxBarSize={isHorizontal ? 16 : 40}
            isAnimationActive={false}
            radius={
              i === reasonKeys.length - 1
                ? isHorizontal
                  ? BAR_RADIUS_END
                  : BAR_RADIUS_TOP
                : [0, 0, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const AttritionStackedBarChart = React.memo(
  AttritionStackedBarChartImpl
);
AttritionStackedBarChart.displayName = 'AttritionStackedBarChart';
