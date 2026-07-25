'use client';

// CalendarSidebar — the "add + navigate + filter" rail that sits beside the
// active view. Composes:
//   1. "+ New event" — a DropdownMenu (not a plain Button) so the optional
//      Copy-from-prior-AY entry point (currently disconnected — see
//      app/(sis)/sis/calendar/page.tsx) has somewhere to live, same contract
//      as the old CalendarToolbar's "+ Add" dropdown.
//   2. Filters — a Popover over CalendarFilterBar (event categories, date
//      range, status). Audience/level and Day types are deliberately NOT in
//      here (see #3/#5).
//   3. Audience — its own always-visible segmented control (KD #76's
//      original intent; it had regressed to a Select buried in the Filters
//      popover). Same segmented Tabs variant CalendarToolbar's view switcher
//      already uses, for one consistent segmented-control language.
//   4. MiniCalendar — month-jump widget with per-date density dots.
//   5. Day types — an always-visible checklist under the mini-calendar
//      (not the Filters popover — moved out per direct feedback), same
//      ChartLegendDot-per-row shape CalendarFilterBar's event-category
//      checklist uses.
//
// Design system: §9.2 one default Button per view (the New-event trigger);
// Popover/DropdownMenu/Tabs/Checkbox are shadcn primitives. Tokens only
// (Hard Rule #7).

import { CalendarPlus, ChevronDown, ListFilter } from 'lucide-react';

import { DAY_TYPE_LEGEND_COLOR } from '@/components/attendance/calendar/calendar-cell';
import { CalendarFilterBar } from '@/components/attendance/calendar/calendar-filter-bar';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';
import { MiniCalendar } from '@/components/attendance/calendar/mini-calendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartLegendDot } from '@/components/dashboard/chart-legend-chip';
import {
  isMultiFilterChecked,
  toggleMultiFilterValue,
  type CalendarFilterState,
} from '@/lib/attendance/calendar-filters';
import {
  AUDIENCE_LABELS,
  AUDIENCE_VALUES,
  DAY_TYPE_LABELS,
  DAY_TYPE_VALUES,
} from '@/lib/schemas/attendance';

// Each "active" signal counts as 1 — mirrors the prior CalendarToolbar count,
// minus `level` and `dayTypes` (each now its own always-visible control, not
// a Filters entry).
function countActiveFilters(s: CalendarFilterState): number {
  let n = 0;
  if (s.from || s.to) n += 1;
  if (s.categories !== null) n += 1;
  if (s.status !== 'all') n += 1;
  return n;
}

export type CalendarSidebarProps = {
  onAddEvent: () => void;
  /** Optional slot — e.g. CopyFromPriorAyDialog rendered as a DropdownMenuItem. */
  copyFromPriorAy?: React.ReactNode;
  filterState: CalendarFilterState;
  onFilter: (next: CalendarFilterState) => void;
  cursor: Date;
  onCursor: (d: Date) => void;
  index: CalendarIndex;
};

export function CalendarSidebar({
  onAddEvent,
  copyFromPriorAy,
  filterState,
  onFilter,
  cursor,
  onCursor,
  index,
}: CalendarSidebarProps) {
  const activeCount = countActiveFilters(filterState);

  return (
    <div className="flex w-[272px] shrink-0 flex-col gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" className="w-full gap-1.5">
            <CalendarPlus className="size-3.5" />
            New event
            <ChevronDown className="size-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[272px]">
          <DropdownMenuItem onSelect={onAddEvent}>
            <CalendarPlus className="size-4" />
            Add event
          </DropdownMenuItem>
          {copyFromPriorAy}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between"
            aria-label={
              activeCount > 0 ? `Filters — ${activeCount} active` : 'Filters'
            }
          >
            <span className="flex items-center gap-1.5">
              <ListFilter className="size-3.5 text-ink-4" />
              Filters
              {activeCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-5 min-w-[20px] px-1.5 font-mono text-[10px] tabular-nums"
                >
                  {activeCount}
                </Badge>
              )}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          aria-label="Calendar filters"
        >
          <CalendarFilterBar value={filterState} onChange={onFilter} />
        </PopoverContent>
      </Popover>

      <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Audience
        </p>
        <Tabs
          value={filterState.level}
          onValueChange={(v) =>
            onFilter({
              ...filterState,
              level: v as CalendarFilterState['level'],
            })
          }
        >
          <TabsList
            variant="segmented"
            aria-label="Audience"
            className="w-full"
          >
            {AUDIENCE_VALUES.map((a) => (
              <TabsTrigger key={a} value={a} className="flex-1">
                {AUDIENCE_LABELS[a]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <MiniCalendar cursor={cursor} onCursor={onCursor} index={index} />

      <div className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Day types
        </p>
        <div className="flex flex-col gap-1.5">
          {DAY_TYPE_VALUES.map((dt) => (
            <label
              key={dt}
              className="flex cursor-pointer items-center gap-2.5"
            >
              <Checkbox
                checked={isMultiFilterChecked(filterState.dayTypes, dt)}
                onCheckedChange={() =>
                  onFilter({
                    ...filterState,
                    dayTypes: toggleMultiFilterValue(
                      DAY_TYPE_VALUES,
                      filterState.dayTypes,
                      dt
                    ),
                  })
                }
              />
              <ChartLegendDot color={DAY_TYPE_LEGEND_COLOR[dt]} />
              <span className="text-sm text-foreground">
                {DAY_TYPE_LABELS[dt]}
              </span>
            </label>
          ))}
        </div>
        {filterState.dayTypes !== null && (
          <button
            type="button"
            className="mt-2 self-start font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onFilter({ ...filterState, dayTypes: null })}
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
}
