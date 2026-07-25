'use client';

// CalendarToolbar — jump-to-term selector + view-switcher. Filters and the
// "+ Add" action live in CalendarSidebar now (calendar-sidebar.tsx) — this
// toolbar owns only the two controls that sit above the active view itself.
//
// Design system: §4.1 shadcn primitives (Select + Tabs); Tabs = segmented
// variant (the audit-log / staff-directory idiom for a view switcher — see
// app/(sis)/sis/audit-log/page.tsx and app/(sis)/sis/admin/staff/page.tsx).
// Tokens only; no raw hex.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
};

// ─── Toolbar ─────────────────────────────────────────────────────────────────

export function CalendarToolbar({
  view,
  onView,
  terms,
  selectedTermId,
  onSelectTerm,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Term selector (which term's days are editable) separated from the
          view-switcher (how dates render) with a visible divider — they
          control genuinely different things: Month/Week/Day are cursor-based
          over the whole AY, only List is term-scoped, so grouping them as
          one flex cluster implied a relationship that isn't there. */}
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

      <div className="h-6 w-px bg-border" aria-hidden />

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
  );
}
