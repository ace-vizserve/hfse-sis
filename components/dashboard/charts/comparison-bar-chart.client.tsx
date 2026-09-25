'use client';

import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';

import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_END,
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  MUTED_SERIES,
  VALUE_LABEL,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

export type ComparisonBarPoint = {
  category: string;
  current: number;
  comparison?: number;
};

export type { YFormat };

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
  // Which figures go on the chart itself. A ranked horizontal list reads down
  // its values, so every bar carries one; a vertical chart labels only its
  // tallest bar, and the rest are one hover away.
  const peak = Math.max(0, ...data.map((d) => d.current));
  const valueText = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return '';
    if (!isHorizontal && (n !== peak || n === 0)) return '';
    return yFormatter ? yFormatter(n) : n.toLocaleString('en-SG');
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{
          top: isHorizontal ? 8 : 20,
          // Room for the value printed past the end of the longest bar.
          right: isHorizontal ? 40 : 8,
          left: isHorizontal ? 4 : 0,
          bottom: 0,
        }}
        barCategoryGap={isHorizontal ? 10 : '20%'}
        barGap={2}
      >
        {/* A ranked horizontal list has its figures on the bars; a grid behind
            it would only compete with them. */}
        {!isHorizontal && <CartesianGrid {...CHART_GRID} />}
        {isHorizontal ? (
          <>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="category"
              tick={CATEGORY_TICK}
              {...CHART_AXIS}
              width={150}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="category"
              tick={CATEGORY_TICK}
              {...CHART_AXIS}
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
              tick={AXIS_TICK}
              {...CHART_AXIS}
              tickFormatter={yFormatter}
              width={36}
            />
          </>
        )}
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={BAR_CURSOR}
          // This chart never applied its own yFormatter to the tooltip, so a
          // percent chart showed a raw unrounded number. Same formatter as the
          // axis now. No share: current and prior are two periods side by
          // side, not parts of one whole.
          content={chartTooltipContent({ format: yFormatter })}
        />
        {showCmp && (
          <Legend
            content={chartLegendContent({
              current: 'series-1',
              comparison: 'neutral',
            })}
          />
        )}
        <Bar
          dataKey="current"
          name="Current"
          fill="var(--color-series-1)"
          radius={isHorizontal ? BAR_RADIUS_END : BAR_RADIUS_TOP}
          maxBarSize={isHorizontal ? 14 : 32}
          // A faint track behind each horizontal bar, so a short bar still
          // reads as a share of the longest.
          background={
            isHorizontal
              ? { fill: 'var(--color-border)', fillOpacity: 0.5, radius: 4 }
              : undefined
          }
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
        >
          <LabelList
            dataKey="current"
            position={isHorizontal ? 'right' : 'top'}
            offset={8}
            formatter={valueText}
            style={VALUE_LABEL}
          />
        </Bar>
        {showCmp && (
          <Bar
            dataKey="comparison"
            name="Prior"
            fill={MUTED_SERIES}
            fillOpacity={0.55}
            radius={isHorizontal ? BAR_RADIUS_END : BAR_RADIUS_TOP}
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
