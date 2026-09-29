'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';

import { SEGMENT_EDGE } from './chart-primitives';

export type TreemapBlock = { name: string; value: number };

export type TreemapChartProps = {
  data: TreemapBlock[];
  /** The blocks' colour as a CSS value that exists at runtime (e.g. `houseChartColor()`). */
  color?: string;
  /** What a value counts, for labels and the tooltip — "points". */
  unit?: string;
  height?: number;
};

// A block is this colour mixed into the card: bigger blocks a little
// stronger, capped so the ink label stays readable on every fill.
const MIN_MIX = 22;
const MAX_MIX = 58;

/** Rough characters that fit across a block at 11px. */
function fitText(text: string, width: number): string | null {
  const chars = Math.floor((width - 14) / 6.2);
  if (chars < 4) return null;
  return text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text;
}

type BlockProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  name?: string;
  value?: number;
  // Passed on the element; recharts merges each node's geometry in beside them.
  color: string;
  max: number;
  unit: string;
};

function Block(props: BlockProps) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth,
    name = '',
    value = 0,
    color,
    max,
    unit,
  } = props;
  // Depth 0 is the root the whole map sits in — draw only the leaves.
  if (depth !== 1 || width <= 0 || height <= 0) return null;
  const share = max > 0 ? value / max : 0;
  const mix = Math.round(MIN_MIX + share * (MAX_MIX - MIN_MIX));
  // Small blocks carry no label — the tooltip names them.
  const showLabel = width >= 64 && height >= 38;
  const title = showLabel ? fitText(name, width) : null;
  const amount = `${value.toLocaleString('en-SG')} ${unit}`;
  const amountFits = showLabel ? fitText(amount, width) === amount : false;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        ry={4}
        fill={`color-mix(in srgb, ${color} ${mix}%, var(--color-card))`}
        {...SEGMENT_EDGE}
      />
      {title && (
        <text
          x={x + 8}
          y={y + 17}
          fontSize={11}
          fontWeight={600}
          fill="var(--color-foreground)"
          style={{ pointerEvents: 'none' }}
        >
          {title}
        </text>
      )}
      {title && amountFits && (
        <text
          x={x + 8}
          y={y + 31}
          fontSize={11}
          fontFamily="var(--font-mono)"
          fill="var(--color-ink-2)"
          style={{ pointerEvents: 'none' }}
        >
          {amount}
        </text>
      )}
    </g>
  );
}

function TreemapChartImpl({
  data,
  color = 'var(--color-series-1)',
  unit = 'points',
  height = 260,
}: TreemapChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap
        data={data}
        dataKey="value"
        nameKey="name"
        aspectRatio={4 / 3}
        isAnimationActive={false}
        content={<Block color={color} max={max} unit={unit} />}
      >
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as TreemapBlock | undefined;
            if (!active || !row) return null;
            return (
              <div className="min-w-[11rem] max-w-[20rem] rounded-lg border border-border bg-popover px-3.5 py-3 shadow-lg">
                <div className="mb-2 border-b border-border pb-2 text-[13.5px] font-semibold leading-tight text-foreground">
                  {row.name}
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: color }}
                  />
                  <span className="font-mono text-[15px] font-bold leading-none tabular-nums text-foreground">
                    {row.value.toLocaleString('en-SG')}
                  </span>
                  <span className="text-[12.5px] font-medium text-ink-2">
                    {unit}
                  </span>
                </div>
              </div>
            );
          }}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

export const TreemapChart = React.memo(TreemapChartImpl);
TreemapChart.displayName = 'TreemapChart';
