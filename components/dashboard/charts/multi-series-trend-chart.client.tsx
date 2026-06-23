'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type MultiSeriesTrendSeries = {
  key: string;
  label: string;
  muted?: boolean;
};

export type YFormat = 'number' | 'percent' | 'days';

export type MultiSeriesTrendChartProps = {
  /** Each series maps to one line. series[i].key must be a key in data objects. */
  series: MultiSeriesTrendSeries[];
  /** Each object has 'x' (string label) + one numeric key per series. */
  data: Array<Record<string, string | number | null>>;
  height?: number;
  yFormat?: YFormat;
  /** Fixed Y domain e.g. [0, 100] for grade charts. */
  yDomain?: [number, number];
};

const SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

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

function MultiSeriesTrendChartImpl({
  series,
  data,
  height = 240,
  yFormat,
  yDomain,
}: MultiSeriesTrendChartProps) {
  const yFormatter = formatterFor(yFormat);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
          cursor={{
            stroke: 'var(--color-muted-foreground)',
            strokeDasharray: '3 3',
          }}
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
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          iconType="line"
          iconSize={12}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={
              s.muted
                ? 'var(--color-muted-foreground)'
                : SERIES_COLORS[i % SERIES_COLORS.length]
            }
            strokeWidth={s.muted ? 2 : 2.5}
            strokeDasharray={s.muted ? '5 4' : undefined}
            dot={false}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: 'var(--color-background)',
            }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const MultiSeriesTrendChart = React.memo(MultiSeriesTrendChartImpl);
MultiSeriesTrendChart.displayName = 'MultiSeriesTrendChart';
