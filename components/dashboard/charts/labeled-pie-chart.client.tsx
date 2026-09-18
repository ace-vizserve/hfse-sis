'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { chartTooltipContent } from './chart-tooltip';

/**
 * A full pie with the percentage rendered ON each slice (recharts' "Pie Chart
 * With Customized Label" pattern). Use for a genuine partition where the share
 * of each slice IS the story. A slice thinner than ~3% has its on-slice label
 * suppressed (the text wouldn't fit legibly) — the side legend still carries
 * its exact count + %, so nothing is lost. Colours are real CSS custom
 * properties (Hard Rule #7); the legend swatch is the exact slice fill.
 */

export type LabeledPieSlice = { name: string; value: number };

export type LabeledPieChartProps = {
  data: LabeledPieSlice[];
  colors?: string[];
  height?: number;
};

const DEFAULT_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-brand-mint)',
  'var(--color-brand-amber)',
];

const RADIAN = Math.PI / 180;

type SliceLabelProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
};

function renderSliceLabel({
  cx = 0,
  cy = 0,
  midAngle = 0,
  innerRadius = 0,
  outerRadius = 0,
  percent = 0,
}: SliceLabelProps) {
  // Too thin for a legible on-slice label — the legend carries its %.
  if (percent < 0.03) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="white"
      fontSize={11.5}
      fontWeight={700}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {`${Math.round(percent * 100)}%`}
    </text>
  );
}

function LabeledPieChartImpl({
  data,
  colors = DEFAULT_COLORS,
  height = 260,
}: LabeledPieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="94%"
              labelLine={false}
              label={renderSliceLabel}
              stroke="var(--color-background)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              wrapperStyle={{ zIndex: 20 }}
              content={chartTooltipContent({
                share: true,
                // One slice per hover, so the base has to be the whole pie —
                // the same total the on-slice label and the side legend use.
                base: () => total,
                totalLabel: 'Total',
              })}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
        {sorted.map((slice) => {
          const idx = data.findIndex((d) => d.name === slice.name);
          const pct = total > 0 ? (slice.value / total) * 100 : 0;
          return (
            <li key={slice.name} className="flex items-center gap-3">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colors[idx % colors.length] }}
              />
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                <span className="truncate text-[12px] text-foreground">
                  {slice.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
                  {slice.value.toLocaleString('en-SG')}
                  <span className="ml-1.5 text-ink-5">{pct.toFixed(0)}%</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const LabeledPieChart = React.memo(LabeledPieChartImpl);
LabeledPieChart.displayName = 'LabeledPieChart';
