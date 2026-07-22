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

/**
 * One vertical stacked bar per level: returned (mint, base) + did-not-return
 * (grey, cap), which together sum to that level's prior-year cohort. Unlike a
 * pure retention-rate bar, the full bar HEIGHT encodes the ABSOLUTE cohort
 * size, so an 80% at a 5-student level never visually reads the same as an 80%
 * at a 40-student level. returned + didNotReturn is a genuine partition of the
 * prior cohort — the honest basis for a stacked bar (never independent rates).
 * Rows arrive worst-retention-first; the caller controls order. The caller is
 * also responsible for excluding the terminal grade (S4) — a graduating cohort
 * structurally can't "return," so it isn't attrition.
 */

export type RetentionStackRow = {
  level: string;
  returned: number;
  didNotReturn: number;
  priorTotal: number;
  pct: number | null;
};

export type RetentionStackedBarChartProps = {
  data: RetentionStackRow[];
  height?: number;
};

function RetentionStackedBarChartImpl({
  data,
  height = 280,
}: RetentionStackedBarChartProps) {
  // Derive the top-of-bar rate label here so the public row shape stays the
  // caller's own data (no display strings leaking into the data contract).
  const rows = data.map((d) => ({
    ...d,
    pctLabel: d.pct !== null ? `${d.pct}%` : '',
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows}
        margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
        barCategoryGap="24%"
      >
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
          opacity={0.6}
        />
        <XAxis
          type="category"
          dataKey="level"
          tick={{ fontSize: 11, fill: 'var(--color-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          type="number"
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-accent)', opacity: 0.5 }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 11,
            padding: '8px 10px',
          }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0].payload as RetentionStackRow;
            return (
              <div
                style={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  fontSize: 11,
                  padding: '8px 10px',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {row.level}
                </div>
                <div>{row.pct ?? 0}% retained</div>
                <div>
                  {row.returned.toLocaleString('en-SG')} of{' '}
                  {row.priorTotal.toLocaleString('en-SG')} returned
                </div>
                <div>
                  {row.didNotReturn.toLocaleString('en-SG')} did not return
                </div>
              </div>
            );
          }}
        />
        <Legend
          content={chartLegendContent({
            Returned: 'fresh',
            'Did not return': 'neutral',
          })}
        />
        <Bar
          dataKey="returned"
          name="Returned"
          stackId="cohort"
          fill="var(--color-brand-mint)"
          maxBarSize={48}
          isAnimationActive={false}
        />
        <Bar
          dataKey="didNotReturn"
          name="Did not return"
          stackId="cohort"
          fill="var(--color-muted-foreground)"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="pctLabel"
            position="top"
            offset={8}
            style={{
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              fill: 'var(--color-foreground)',
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const RetentionStackedBarChart = React.memo(
  RetentionStackedBarChartImpl
);
RetentionStackedBarChart.displayName = 'RetentionStackedBarChart';
