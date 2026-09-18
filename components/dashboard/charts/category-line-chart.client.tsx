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

import { formatterFor, type YFormat } from './chart-primitives';
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
  color = 'var(--color-chart-1)',
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
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
          opacity={0.6}
        />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 11, fill: 'var(--color-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
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
          content={chartTooltipContent({ format: yFormatter })}
        />
        <Line
          type="monotone"
          dataKey="y"
          name={seriesLabel}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: color }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="y"
            position="top"
            offset={10}
            formatter={labelFmt as never}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              fill: 'var(--color-foreground)',
            }}
          />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

export const CategoryLineChart = React.memo(CategoryLineChartImpl);
CategoryLineChart.displayName = 'CategoryLineChart';
