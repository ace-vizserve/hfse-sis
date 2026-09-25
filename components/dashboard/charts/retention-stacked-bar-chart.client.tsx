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
  BAR_RADIUS_TOP,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  MUTED_SERIES,
  SEGMENT_EDGE,
  VALUE_LABEL,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';

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
        <CartesianGrid {...CHART_GRID} />
        <XAxis
          type="category"
          dataKey="level"
          tick={CATEGORY_TICK}
          {...CHART_AXIS}
          interval={0}
        />
        <YAxis
          type="number"
          tick={AXIS_TICK}
          {...CHART_AXIS}
          allowDecimals={false}
          width={36}
        />
        <Tooltip
          wrapperStyle={{ zIndex: 20 }}
          cursor={BAR_CURSOR}
          // Everything the old hand-written box said survives: the level is the
          // heading, the retention rate is the note, the two counts are the
          // rows (each keyed to its own bar colour), and the prior-year cohort
          // they are out of is the footer. The base is the stored priorTotal
          // rather than the sum of the two bars, so a level whose parts don't
          // reconcile shows that rather than hiding it behind a forced 100%.
          content={chartTooltipContent({
            share: true,
            totalLabel: 'Prior-year cohort',
            base: (ctx) =>
              (ctx.row as RetentionStackRow | undefined)?.priorTotal ?? 0,
            note: (ctx) => {
              const pct = (ctx.row as RetentionStackRow | undefined)?.pct;
              return pct === null || pct === undefined
                ? null
                : `${pct}% retained`;
            },
          })}
        />
        {/* Returned keeps the status mint (healthy = stayed) rather than a
            series colour: retained vs lost is a status the reader relies on.
            Did-not-return stays grey — now the shared muted grey. */}
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
          {...SEGMENT_EDGE}
          maxBarSize={48}
          isAnimationActive={false}
        />
        <Bar
          dataKey="didNotReturn"
          name="Did not return"
          stackId="cohort"
          fill={MUTED_SERIES}
          {...SEGMENT_EDGE}
          radius={BAR_RADIUS_TOP}
          maxBarSize={48}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="pctLabel"
            position="top"
            offset={8}
            style={VALUE_LABEL}
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
