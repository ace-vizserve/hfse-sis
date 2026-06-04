'use client';

// CalendarToolbar — unified view-switcher + filter trigger + Add action.
//
// Layout: left = Tabs view switcher (Term / Month / Week / Day / List).
//         right = Filters Popover (outline Button + active-count Badge)
//                 + "+ Add" DropdownMenu (primary CTA, one per view).
//
// Design system: §4.1 shadcn primitives; §9.2 one default Button per view
// (the "+ Add" button); Filters = outline; Tabs = default variant;
// Badge §9.3 secondary count pill. Tokens only; no raw hex.

import { CalendarPlus, ChevronDown, ListFilter } from 'lucide-react';

import { CalendarFilterBar } from '@/components/attendance/calendar/calendar-filter-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { CalendarFilterState } from '@/lib/attendance/calendar-filters';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarView = 'term' | 'month' | 'week' | 'day' | 'list';

const VIEW_LABELS: Record<CalendarView, string> = {
  term: 'Term',
  month: 'Month',
  week: 'Week',
  day: 'Day',
  list: 'List',
};

const VIEWS: CalendarView[] = ['term', 'month', 'week', 'day', 'list'];

export type CalendarToolbarProps = {
  view: CalendarView;
  onView: (v: CalendarView) => void;
  filterState: CalendarFilterState;
  onFilter: (next: CalendarFilterState) => void;
  onAddEvent: () => void;
  /**
   * Optional slot for a secondary Add-menu item (e.g. CopyFromPriorAyDialog
   * trigger rendered as a DropdownMenuItem). When provided it is appended
   * below the primary "Add event" item in the dropdown.
   */
  copyFromPriorAy?: React.ReactNode;
};

// ─── Active-filter count ─────────────────────────────────────────────────────
//
// Each "active" signal counts as 1:
//   • from || to — date range set (pair counts as one filter)
//   • categories.length > 0
//   • level !== 'all'
//   • status !== 'all'
//   • tentativeOnly

function countActiveFilters(s: CalendarFilterState): number {
  let n = 0;
  if (s.from || s.to) n += 1;
  if (s.categories.length > 0) n += 1;
  if (s.level !== 'all') n += 1;
  if (s.status !== 'all') n += 1;
  if (s.tentativeOnly) n += 1;
  return n;
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

export function CalendarToolbar({
  view,
  onView,
  filterState,
  onFilter,
  onAddEvent,
  copyFromPriorAy,
}: CalendarToolbarProps) {
  const activeCount = countActiveFilters(filterState);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Left — view-switcher tabs (Term / Month / Week / Day / List) */}
      <Tabs value={view} onValueChange={(v) => onView(v as CalendarView)}>
        <TabsList variant="default" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {VIEW_LABELS[v]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Right — Filters popover + Add dropdown */}
      <div className="flex items-center gap-2">
        {/* Filters popover — outline Button, count Badge when active */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-label={
                activeCount > 0 ? `Filters — ${activeCount} active` : 'Filters'
              }
            >
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
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-0"
            aria-label="Calendar filters"
          >
            <CalendarFilterBar value={filterState} onChange={onFilter} />
          </PopoverContent>
        </Popover>

        {/* + Add dropdown — primary CTA (one default Button per view, §9.2) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="gap-1.5">
              <CalendarPlus className="size-3.5" />
              Add
              <ChevronDown className="size-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onAddEvent}>
              <CalendarPlus className="size-4" />
              Add event
            </DropdownMenuItem>
            {/* Optional slot — e.g. CopyFromPriorAyDialog rendered as a
                DropdownMenuItem or DropdownMenuSub by the parent. The slot is
                rendered verbatim so the parent controls its exact markup. */}
            {copyFromPriorAy}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
