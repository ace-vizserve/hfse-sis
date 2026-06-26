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

export type AttritionStackedBarPoint = {
  level: string;
  [reasonKey: string]: string | number;
};

export type AttritionStackedBarChartProps = {
  data: AttritionStackedBarPoint[];
  reasonKeys: string[];
  height?: number;
};

// Palette — reason segments cycle through chart tokens.
// Controllable reasons (financial/disciplinary/academic_fit) surface first in
// the legend because they're the ones the registrar can act on; unspecified
// last. The colour ordering follows the same cycle as the donut chart so the
// two views are visually consistent within the Attrition section.
const REASON_COLORS: ChartLegendChipColor[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'very-stale',
  'neutral',
];

// CSS var equivalents for recharts fill (can't use Tailwind here).
const REASON_COLOR_VARS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-destructive)',
  'var(--color-muted-foreground)',
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
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          horizontal={!isHorizontal}
          vertical={isHorizontal}
          opacity={0.6}
        />
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="level"
              tick={{ fontSize: 11, fill: 'var(--color-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="level"
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={56}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 11,
            padding: '8px 10px',
          }}
          cursor={{ fill: 'var(--color-accent)', opacity: 0.5 }}
          formatter={(value) => {
            const v = typeof value === 'number' ? value : Number(value ?? 0);
            return [v.toLocaleString('en-SG'), ''];
          }}
        />
        <Legend content={chartLegendContent(legendPalette)} />
        {reasonKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={key}
            stackId="reasons"
            fill={REASON_COLOR_VARS[i % REASON_COLOR_VARS.length]}
            maxBarSize={isHorizontal ? 16 : 40}
            isAnimationActive={false}
            radius={
              i === reasonKeys.length - 1
                ? isHorizontal
                  ? [0, 4, 4, 0]
                  : [4, 4, 0, 0]
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
