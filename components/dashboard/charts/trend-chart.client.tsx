'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
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
  ACTIVE_DOT,
  AXIS_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  LINE_CURSOR,
  LINE_WIDTH,
  MUTED_SERIES,
  VALUE_LABEL,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

export type TrendPoint = { x: string; y: number };

export type { YFormat };

export type TrendChartProps = {
  label: string;
  current: TrendPoint[];
  /** Null when no comparison is set — overlay is hidden. */
  comparison?: TrendPoint[] | null;
  height?: number;
  yFormat?: YFormat;
  alignComparison?: boolean;
  /**
   * `compact` drops the y-axis and the grid, and labels only the first and
   * last point, for use as a sparkline. The tooltip stays: with no axis to
   * read, hovering is the only way to get a figure off the line.
   *
   * A second charting component would have been the easy way to get a 40px
   * trend, and it is how two surfaces end up drawing the same data two ways.
   * One component, one shape, two densities — a teacher who has read the
   * attendance chart has read these.
   */
  variant?: 'full' | 'compact';
  /**
   * Fixes the y-axis instead of letting it fit the data.
   *
   * REQUIRED whenever charts are meant to be read against each other. Recharts
   * scales the top of the axis to the series by default, so three sparklines
   * drawn side by side each get their own scale: a series sitting at 88–92 and
   * one collapsing 92 → 55 both fill their box, and the collapse becomes
   * invisible — the exact comparison small multiples exist to make.
   */
  domain?: [number, number];
  /**
   * `fall` draws the mark in the destructive colour. Never the only signal —
   * every caller pairs it with a sign and a figure, so a colourblind reader
   * loses nothing.
   */
  tone?: 'default' | 'fall';
  /** Exactly which y-axis values are labelled. Pairs with a fixed `domain`. */
  ticks?: number[];
  /**
   * Prints each point's value above it.
   *
   * A fixed domain is honest and, on a short series, nearly flat — a term grade
   * slipping 77 → 74 is three pixels of movement across a 0–100 axis. The
   * figures on the points are what stop that being a chart nobody can read.
   */
  showValues?: boolean;
};

function TrendChartImpl({
  label,
  current,
  comparison,
  height = 220,
  yFormat,
  alignComparison = true,
  variant = 'full',
  domain,
  tone = 'default',
  ticks,
  showValues = false,
}: TrendChartProps) {
  const compact = variant === 'compact';
  const yFormatter = formatterFor(yFormat);
  const mark =
    tone === 'fall' ? 'var(--color-destructive)' : 'var(--color-series-1)';
  const lastIndex = current.length - 1;
  // The latest point is the one a reader looks for, so a full-size chart that
  // is not already printing every value marks it and prints its figure.
  const markLatest = !compact && !showValues && lastIndex >= 0;

  const merged = current.map((pt, i) => ({
    x: pt.x,
    current: pt.y,
    comparison:
      comparison && alignComparison && comparison[i]
        ? comparison[i].y
        : undefined,
  }));

  // SVG gradient ids are document-global, so the tone belongs in the key —
  // otherwise a fallen chart and a steady one sharing a label share a fill.
  const gradientId = `trend-gradient-${tone}-${label.replace(/\s+/g, '-')}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={merged}
        margin={
          compact
            ? { top: 4, right: 2, left: 2, bottom: 0 }
            : // Printed values need headroom, or a point near the top of a
              // fixed domain has its own figure clipped off the chart.
              {
                top: showValues ? 22 : 8,
                // Room for the latest point's printed figure.
                right: markLatest ? 36 : 4,
                left: 0,
                bottom: 0,
              }
        }
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {/* Lighter on a tall chart: a fixed 0–100 domain fills most of the
                box below the line, and at sparkline opacity that becomes a
                slab of colour rather than a trend. */}
            <stop
              offset="0%"
              stopColor={mark}
              stopOpacity={showValues ? 0.12 : 0.16}
            />
            <stop offset="100%" stopColor={mark} stopOpacity={0} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid {...CHART_GRID} />}
        {/* Compact still labels the ends. A sparkline with no axis at all does
            not say which end is Term 1, and the reader cannot tell a recovery
            from a collapse without that. Only the ends, never abbreviated —
            the school's terms are named "Term 1", not "T1". */}
        <XAxis
          dataKey="x"
          tick={{ ...AXIS_TICK, fontSize: compact ? 9 : AXIS_TICK.fontSize }}
          {...CHART_AXIS}
          interval="preserveStartEnd"
          minTickGap={compact ? 8 : 32}
          height={compact ? 14 : undefined}
          tickMargin={compact ? 2 : 3}
          // Insets the first and last points off the plot edges. Without it a
          // printed value on an end point is centred on the edge and half of
          // it lands on the y-axis or outside the chart — "88%" over "100",
          // and "73%" sliced in half.
          padding={showValues ? { left: 24, right: 24 } : undefined}
        />
        {compact ? (
          // Hidden, but present: an axis element is how a fixed domain is
          // declared. Without it recharts fits the top to the series and the
          // small multiples stop being comparable.
          <YAxis hide domain={domain ?? [0, 'auto']} />
        ) : (
          <YAxis
            tick={AXIS_TICK}
            {...CHART_AXIS}
            tickFormatter={yFormatter}
            width={36}
            domain={domain ?? [0, 'auto']}
            ticks={ticks}
          />
        )}
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={LINE_CURSOR}
          // A period and the same period last year: two readings of one
          // measure, so there is no whole for them to be shares of.
          content={chartTooltipContent({ format: yFormatter })}
        />
        {comparison && (
          <Legend
            content={chartLegendContent({
              current: 'series-1',
              // Grey, matching the dashed grey line it keys.
              comparison: 'neutral',
            })}
          />
        )}
        <Area
          type="monotone"
          dataKey="current"
          name={label}
          stroke={mark}
          strokeWidth={LINE_WIDTH}
          fill={`url(#${gradientId})`}
          // Points are worth marking when their figures are printed — the label
          // needs something to belong to. Otherwise only the latest is marked.
          dot={
            showValues
              ? { r: 3, strokeWidth: 2, fill: 'var(--color-background)' }
              : markLatest
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (p: any) =>
                    p.index === lastIndex ? (
                      <circle
                        key="latest"
                        cx={p.cx}
                        cy={p.cy}
                        r={4}
                        fill={mark}
                        stroke="var(--color-card)"
                        strokeWidth={2}
                      />
                    ) : (
                      <g key={p.index} />
                    )
                : false
          }
          activeDot={{ ...ACTIVE_DOT, fill: mark }}
          isAnimationActive={false}
        >
          {markLatest && (
            <LabelList
              dataKey="current"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={(p: any) =>
                p.index === lastIndex && typeof p.value === 'number' ? (
                  <text
                    x={Number(p.x) + 8}
                    y={Number(p.y) + 4}
                    style={VALUE_LABEL}
                  >
                    {yFormatter
                      ? yFormatter(p.value)
                      : p.value.toLocaleString('en-SG')}
                  </text>
                ) : null
              }
            />
          )}
          {showValues && (
            <LabelList
              dataKey="current"
              position="top"
              offset={9}
              fill="var(--color-foreground)"
              fontSize={12}
              fontWeight={600}
              formatter={(v: unknown) =>
                typeof v === 'number' && yFormatter ? yFormatter(v) : String(v)
              }
            />
          )}
        </Area>
        {comparison && (
          <Area
            type="monotone"
            dataKey="comparison"
            name="Prior period"
            stroke={MUTED_SERIES}
            strokeDasharray="4 4"
            strokeWidth={LINE_WIDTH}
            fill="transparent"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export const TrendChart = React.memo(TrendChartImpl);
TrendChart.displayName = 'TrendChart';
