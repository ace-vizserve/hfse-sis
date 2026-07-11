'use client';

// CalendarToolbar — Jump-to-term selector + view-switcher + filter + Add action.
//
// Layout: left  = Term <Select> THEN Tabs view switcher (Month / Week / Day /
//                 List). Every view is scoped to the selected term.
//         right = Filters Popover (outline Button + active-count Badge)
//                 + "+ Add" DropdownMenu (primary CTA, one per view).
//
// Design system: §4.1 shadcn primitives (Select + Tabs); §9.2 one default Button
// per view (the "+ Add" button); Filters = outline; Tabs = segmented variant
// (the audit-log / staff-directory idiom for a view switcher — see
// app/(sis)/sis/audit-log/page.tsx and app/(sis)/sis/admin/staff/page.tsx);
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CalendarFilterState } from '@/lib/attendance/calendar-filters';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarView = 'month' | 'week' | 'day' | 'list';

const VIEW_LABELS: Record<CalendarView, string> = {
  month: 'Month',
  week: 'Week',
  day: 'Day',
  list: 'List',
};

const VIEWS: CalendarView[] = ['month', 'week', 'day', 'list'];

export type CalendarToolbarProps = {
  view: CalendarView;
  onView: (v: CalendarView) => void;
  /** Terms to offer as jump targets (by id + human label). */
  terms: Array<{ id: string; label: string }>;
  /** The term to jump to / currently shown in the picker. */
  selectedTermId: string;
  /** Fired when the registrar picks a term — moves the cursor there. */
  onSelectTerm: (id: string) => void;
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

function countActiveFilters(s: CalendarFilterState): number {
  let n = 0;
  if (s.from || s.to) n += 1;
  if (s.categories.length > 0) n += 1;
  if (s.level !== 'all') n += 1;
  if (s.status !== 'all') n += 1;
  return n;
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

export function CalendarToolbar({
  view,
  onView,
  terms,
  selectedTermId,
  onSelectTerm,
  filterState,
  onFilter,
  onAddEvent,
  copyFromPriorAy,
}: CalendarToolbarProps) {
  const activeCount = countActiveFilters(filterState);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Left — Term selector THEN view-switcher tabs (Month/Week/Day/List) */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedTermId} onValueChange={onSelectTerm}>
          <SelectTrigger className="h-8 w-max" aria-label="Term">
            <SelectValue placeholder="Select term" />
          </SelectTrigger>
          <SelectContent>
            {terms.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={view} onValueChange={(v) => onView(v as CalendarView)}>
          <TabsList variant="segmented" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {VIEW_LABELS[v]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

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
