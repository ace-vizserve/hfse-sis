'use client';

import * as React from 'react';
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  ACTIVE_DOT,
  AXIS_TICK,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  LINE_CURSOR,
  LINE_WIDTH,
  SERIES_COLORS,
  VALUE_LABEL,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

/**
 * A single line tracing one value across an ORDERED sequence of categories
 * (e.g. the average grade across grade levels P1→S4). Points carry their
 * value as an on-line label so the actual numbers read directly — never an
 * abstract delta. An optional dashed reference line (e.g. the school average)
 * makes "below the line" instantly legible. The y-domain auto-tightens around
 * the data so real dips are visible rather than flattened. Only use when the
 * x categories are a genuine sequence — a line between unrelated buckets would
 * imply continuity that isn't there.
 */

export type CategoryLinePoint = { x: string; y: number };

export type CategoryLineChartProps = {
  data: CategoryLinePoint[];
  height?: number;
  yFormat?: YFormat;
  yDomain?: [number, number];
  referenceValue?: number;
  referenceLabel?: string;
  color?: string;
  /**
   * What the single plotted series is called, e.g. "Average grade". The shared
   * tooltip always names its series, and without this the name falls back to
   * the raw `y` data key.
   */
  seriesLabel?: string;
};

function CategoryLineChartImpl({
  data,
  height = 260,
  yFormat,
  yDomain,
  referenceValue,
  referenceLabel,
  color = SERIES_COLORS[0],
  seriesLabel = 'Value',
}: CategoryLineChartProps) {
  const yFormatter = formatterFor(yFormat);
  const domain: [number, number] =
    yDomain ??
    (() => {
      const ys = data.map((d) => d.y);
      const all = referenceValue !== undefined ? [...ys, referenceValue] : ys;
      const min = all.length ? Math.min(...all) : 0;
      const max = all.length ? Math.max(...all) : 100;
      return [Math.floor(min - 2), Math.ceil(max + 2)];
    })();

  const labelFmt = (v: React.ReactNode) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return yFormatter ? yFormatter(n) : String(n);
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        margin={{ top: 20, right: 20, left: 0, bottom: 0 }}
      >
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="x" tick={CATEGORY_TICK} {...CHART_AXIS} interval={0} />
        <YAxis
          domain={domain}
          tick={AXIS_TICK}
          {...CHART_AXIS}
          tickFormatter={yFormatter}
          width={40}
        />
        {referenceValue !== undefined ? (
          <ReferenceLine
            y={referenceValue}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: referenceLabel ?? String(referenceValue),
              position: 'insideTopRight',
              fontSize: 10,
              fill: 'var(--color-muted-foreground)',
            }}
          />
        ) : null}
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={LINE_CURSOR}
          content={chartTooltipContent({ format: yFormatter })}
        />
        <Line
          type="monotone"
          dataKey="y"
          name={seriesLabel}
          stroke={color}
          strokeWidth={LINE_WIDTH}
          dot={{ r: 3.5, fill: color }}
          activeDot={{ ...ACTIVE_DOT, fill: color }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="y"
            position="top"
            offset={10}
            formatter={labelFmt as never}
            style={VALUE_LABEL}
          />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

export const CategoryLineChart = React.memo(CategoryLineChartImpl);
CategoryLineChart.displayName = 'CategoryLineChart';
