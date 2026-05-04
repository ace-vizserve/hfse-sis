'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { chartLegendContent } from '@/components/dashboard/chart-legend-chip';

export type TrendPoint = { x: string; y: number };

export type YFormat = 'number' | 'percent' | 'days';

function formatterFor(format: YFormat | undefined): ((n: number) => string) | undefined {
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

export type TrendChartProps = {
  label: string;
  current: TrendPoint[];
  /** Null when no comparison is set — overlay is hidden. */
  comparison?: TrendPoint[] | null;
  height?: number;
  yFormat?: YFormat;
  alignComparison?: boolean;
};

export function TrendChart({
  label,
  current,
  comparison,
  height = 220,
  yFormat,
  alignComparison = true,
}: TrendChartProps) {
  const yFormatter = formatterFor(yFormat);

  const merged = current.map((pt, i) => ({
    x: pt.x,
    current: pt.y,
    comparison: comparison && alignComparison && comparison[i] ? comparison[i].y : undefined,
  }));

  const gradientId = `trend-gradient-${label.replace(/\s+/g, '-')}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={merged} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          width={36}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-muted-foreground)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 11,
            padding: '8px 10px',
          }}
          labelStyle={{ color: 'var(--color-foreground)', fontWeight: 600, marginBottom: 2 }}
          formatter={(value) => {
            const v = typeof value === 'number' ? value : Number(value);
            return yFormatter ? yFormatter(v) : v;
          }}
        />
        {comparison && (
          <Legend content={chartLegendContent({ current: 'chart-1', comparison: 'chart-3' })} />
        )}
        <Area
          type="monotone"
          dataKey="current"
          name={label}
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background)' }}
          isAnimationActive={false}
        />
        {comparison && (
          <Area
            type="monotone"
            dataKey="comparison"
            name="Prior period"
            stroke="var(--color-muted-foreground)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            fill="transparent"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
