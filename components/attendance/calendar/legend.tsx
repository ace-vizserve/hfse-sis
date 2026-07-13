// Legend — two-row chip panel documenting every visual state in the calendar
// grid. Static content — rendered as a server component (no 'use client').
//
// Design system §10.4: "when one legend documents multiple visuals … wrap in
// a Card with two labelled rows; mono-uppercase eyebrow per row." This
// legend documents two distinct visual families — day-type overrides and
// event categories — so it takes that shape, mirroring the two-row legend
// pattern in components/attendance/wide-grid.tsx (Status · cell colour /
// Calendar · column header).
//
// §10.2 single source of truth: every chip's color comes from the SAME
// DAY_TYPE_LEGEND_COLOR / EVENT_CATEGORY_LEGEND_COLOR maps CalendarCell uses
// to paint the grid — this file never hand-picks a color. Labels come from
// the canonical DAY_TYPE_LABELS / EVENT_CATEGORY_LABELS maps (also used by
// the filter bar and the day-action sheet) so the legend text can't drift
// from the rest of the surface either.
//
// Full coverage: the prior version only documented one event category
// ("Important date") even though the grid, filter bar, and list view can
// paint any of the 9 EVENT_CATEGORY_VALUES in 9 distinct colors — an
// under-documented key per §10.5's "does every swatch on the surface have a
// key entry" check. This version iterates both value lists so a new
// day-type or event category can never silently go undocumented.

import {
  DAY_TYPE_LEGEND_COLOR,
  EVENT_CATEGORY_GROUPS,
  EVENT_CATEGORY_LEGEND_COLOR,
} from '@/components/attendance/calendar/calendar-cell';
import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import { Card } from '@/components/ui/card';
import {
  DAY_TYPE_LABELS,
  DAY_TYPE_VALUES,
  EVENT_CATEGORY_LABELS,
} from '@/lib/schemas/attendance';

export function Legend() {
  return (
    <Card className="p-4 text-xs text-muted-foreground">
      <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
        Day types
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
        {DAY_TYPE_VALUES.map((dayType) => (
          <ChartLegendChip
            key={dayType}
            color={DAY_TYPE_LEGEND_COLOR[dayType]}
            label={DAY_TYPE_LABELS[dayType]}
          />
        ))}
        {/* HBL overlay = a school-holiday day where attendance is still
            taken — a compound state (school_holiday + hbl_overlay), not a
            6th day type, so it reads as the two chips above combined. */}
        <span className="inline-flex items-center gap-1">
          <ChartLegendChip
            color={DAY_TYPE_LEGEND_COLOR.school_holiday}
            label={DAY_TYPE_LABELS.school_holiday}
          />
          <span className="font-mono text-[9px] text-muted-foreground">+</span>
          <ChartLegendChip
            color={DAY_TYPE_LEGEND_COLOR.hbl}
            label={DAY_TYPE_LABELS.hbl}
          />
          <span className="font-mono text-[9px] text-muted-foreground">
            = attendance still taken
          </span>
        </span>
      </div>

      <p className="mt-4 mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
        Event categories
      </p>
      {/* Grouped into 3 clusters (layout redesign pass, Miller's Law) instead
          of one flat 9-chip row — EVENT_CATEGORY_GROUPS is the single source
          both this legend and the filter bar's category checklist read. */}
      <div className="space-y-2.5">
        {EVENT_CATEGORY_GROUPS.map((group) => (
          <div
            key={group.label}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-2"
          >
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {group.label}
            </span>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-foreground">
              {group.categories.map((category) => (
                <ChartLegendChip
                  key={category}
                  color={EVENT_CATEGORY_LEGEND_COLOR[category]}
                  label={EVENT_CATEGORY_LABELS[category]}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
