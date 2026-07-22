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

export type ComparisonBarPoint = {
  category: string;
  current: number;
  comparison?: number;
};

export type YFormat = 'number' | 'percent' | 'days';

function formatterFor(
  format: YFormat | undefined
): ((n: number) => string) | undefined {
  switch (format) {
    case 'percent':
      return (n) => `${Math.round(n)}%`;
    case 'days':
      return (n) => `${Math.round(n)}d`;
    case 'number':
      return (n) => n.toLocaleString('en-SG');
    default:
      return undefined;
  }
}

export type ComparisonBarChartProps = {
  data: ComparisonBarPoint[];
  height?: number;
  orientation?: 'vertical' | 'horizontal';
  yFormat?: YFormat;
  onSegmentClick?: (category: string) => void;
  /**
   * Tilt vertical-orientation category labels -30° so long names (e.g.
   * "Ongoing Verification") don't collide at 6+ buckets. Default true keeps
   * every existing caller's layout unchanged. Set false for short, fixed-
   * width labels (e.g. a 5-tier "1★"..."5★" scale) — rotating a 2-character
   * label buys nothing and can render the glyph oddly at an angle.
   */
  rotateLabels?: boolean;
};

function ComparisonBarChartImpl({
  data,
  height = 260,
  orientation = 'vertical',
  yFormat,
  onSegmentClick,
  rotateLabels = true,
}: ComparisonBarChartProps) {
  const yFormatter = formatterFor(yFormat);
  const showCmp = data.some((d) => typeof d.comparison === 'number');
  const isHorizontal = orientation === 'horizontal';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, left: isHorizontal ? 4 : 0, bottom: 0 }}
        barCategoryGap={isHorizontal ? 10 : '20%'}
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
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter}
            />
            <YAxis
              type="category"
              dataKey="category"
              tick={{ fontSize: 11, fill: 'var(--color-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={150}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="category"
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              interval={0}
              // Tilt category labels so longer level / status names don't
              // collide on charts with 6+ buckets (e.g. "Applications by
              // level", "Documents collected by level"). Anchor at the end
              // of the rotated text + reserve enough axis height to avoid
              // clipping. Short fixed-width labels (rotateLabels=false) stay
              // flat and horizontal — nothing to avoid colliding with.
              angle={rotateLabels ? -30 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? 56 : 28}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter}
              width={36}
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
        />
        {showCmp && (
          <Legend
            content={chartLegendContent({
              current: 'chart-1',
              comparison: 'chart-3',
            })}
          />
        )}
        <Bar
          dataKey="current"
          name="Current"
          fill="var(--color-chart-1)"
          radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={isHorizontal ? 14 : 32}
          isAnimationActive={false}
          onClick={
            onSegmentClick
              ? (((data: unknown) => {
                  const payload = data as {
                    payload?: { category?: string };
                    category?: string;
                  };
                  const category =
                    payload?.payload?.category ?? payload?.category;
                  if (category) onSegmentClick(category);
                }) as never)
              : undefined
          }
          style={onSegmentClick ? { cursor: 'pointer' } : undefined}
        />
        {showCmp && (
          <Bar
            dataKey="comparison"
            name="Prior"
            fill="var(--color-chart-3)"
            fillOpacity={0.5}
            radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={isHorizontal ? 14 : 32}
            isAnimationActive={false}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const ComparisonBarChart = React.memo(ComparisonBarChartImpl);
ComparisonBarChart.displayName = 'ComparisonBarChart';
