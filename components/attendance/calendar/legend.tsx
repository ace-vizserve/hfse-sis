// Legend — static chip strip documenting every visual state in the calendar
// grid. Static content — rendered as a server component (no 'use client').
//
// Design system §10: gradient pill in the legend MUST match the gradient pill
// in the cell (§10.2 single source). Every chip here uses ChartLegendChip
// with the same DAY_TYPE_LEGEND_COLOR value that CalendarCell uses, so the
// two can never drift apart.
//
// Container styling lifted 1:1 from calendar-admin-client.tsx Legend strip.

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-muted/25 px-4 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]">
      {/* Day-type chips — colors match DAY_TYPE_LEGEND_COLOR in CalendarCell */}
      <ChartLegendChip color="fresh" label="School day" />
      <ChartLegendChip color="very-stale" label="Public holiday" />
      <ChartLegendChip color="stale" label="School holiday" />
      <ChartLegendChip color="primary" label="HBL" />

      {/* HBL overlay = school_holiday + HBL together */}
      <div className="flex items-center gap-1">
        <ChartLegendChip color="stale" label="School holiday" />
        <span className="font-mono text-[9px] text-muted-foreground">+</span>
        <ChartLegendChip color="primary" label="HBL" />
        <span className="font-mono text-[9px] text-muted-foreground">
          = HBL overlay
        </span>
      </div>

      <ChartLegendChip color="neutral" label="No class" />
      <ChartLegendChip color="chart-4" label="Important date" />

      {/* Term break — 'neutral' matches the ChartLegendChip rendered in
          CalendarCell when isBreak=true, satisfying §10.2 single-source rule. */}
      <ChartLegendChip color="neutral" label="Term break" />
    </div>
  );
}
