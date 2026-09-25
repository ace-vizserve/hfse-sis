'use client';

import * as React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { HoverHint } from '@/components/ui/hover-hint';

import { SEGMENT_EDGE, SERIES_COLORS } from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

export type DonutSlice = { name: string; value: number };

export type DonutChartProps = {
  data: DonutSlice[];
  height?: number;
  colors?: string[];
  centerLabel?: string;
  centerValue?: string | number;
  /**
   * What the centre number counts, in one plain sentence. The centre is the
   * first thing anyone reads on a donut and explained itself least — the whole
   * overlay is `pointer-events-none` so it does not eat the ring's hover, and
   * that made the headline figure the one inert thing on the chart.
   */
  centerHint?: React.ReactNode;
  onSegmentClick?: (sliceName: string) => void;
};

// The five series colours, then greys. A sixth or seventh slice is small by
// the time it is reached, and a grey reads as "the rest" rather than as a new
// colour competing with the first five.
const DEFAULT_COLORS = [
  ...SERIES_COLORS,
  'var(--color-ink-4)',
  'var(--color-ink-5)',
];

function DonutChartImpl({
  data,
  height = 220,
  colors = DEFAULT_COLORS,
  centerLabel,
  centerValue,
  centerHint,
  onSegmentClick,
}: DonutChartProps) {
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
              // A thinner ring than before: the hole carries the total, and a
              // slab of colour around it competed with that figure.
              innerRadius="70%"
              outerRadius="92%"
              paddingAngle={1.5}
              {...SEGMENT_EDGE}
              isAnimationActive={false}
              onClick={
                onSegmentClick
                  ? (payload: { name?: string }) => {
                      if (payload?.name) onSegmentClick(payload.name);
                    }
                  : undefined
              }
              style={onSegmentClick ? { cursor: 'pointer' } : undefined}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              wrapperStyle={{ zIndex: 20 }}
              content={chartTooltipContent({
                share: true,
                // A pie tooltip reports one slice, so the default base (the sum
                // of the rows shown) would make every slice 100%. The whole
                // ring is the denominator — the same `total` the side legend
                // and the old formatter divide by.
                base: () => total,
                totalLabel: centerLabel ?? 'Total',
              })}
            />
          </PieChart>
        </ResponsiveContainer>
        {centerValue !== undefined && (
          // The overlay stays `pointer-events-none` — it spans the whole chart
          // box, so making it hoverable would steal every slice's hover. Only
          // the text in the hole opts back in.
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <HoverHint hint={centerHint}>
              <div
                className={
                  centerHint
                    ? 'pointer-events-auto flex cursor-help flex-col items-center'
                    : 'flex flex-col items-center'
                }
              >
                <span className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
                  {centerValue}
                </span>
                {centerLabel && (
                  <span className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                    {centerLabel}
                  </span>
                )}
              </div>
            </HoverHint>
          </div>
        )}
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
        {sorted.map((slice, i) => {
          const idx = data.findIndex((d) => d.name === slice.name);
          const pct = total > 0 ? (slice.value / total) * 100 : 0;
          return (
            <li
              key={slice.name}
              className={`flex items-center gap-3${onSegmentClick ? ' cursor-pointer rounded-md transition-colors hover:bg-accent/40' : ''}`}
              onClick={
                onSegmentClick ? () => onSegmentClick(slice.name) : undefined
              }
              role={onSegmentClick ? 'button' : undefined}
              tabIndex={onSegmentClick ? 0 : undefined}
              onKeyDown={
                onSegmentClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSegmentClick(slice.name);
                      }
                    }
                  : undefined
              }
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: colors[idx % colors.length] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-foreground">
                    {slice.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-4">
                    {slice.value.toLocaleString('en-SG')}
                    <span className="ml-1.5 text-ink-5">{pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: colors[idx % colors.length],
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const DonutChart = React.memo(DonutChartImpl);
DonutChart.displayName = 'DonutChart';
