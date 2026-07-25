import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  isEncodableDayType,
  type Audience,
  type DayType,
  type EventCategory,
} from '@/lib/schemas/attendance';

export type StatusFilter = 'all' | 'open' | 'closed';

export type CalendarFilterState = {
  from: string | null; // yyyy-MM-dd inclusive
  to: string | null; // yyyy-MM-dd inclusive
  // dayTypes and level are both surfaced as their own always-visible sidebar
  // controls (calendar-sidebar.tsx) rather than the Filters popover, but
  // still live on this shared state object since filterDays/filterEvents
  // apply them the same way as every other axis here.
  //
  // `null` = no filter applied, show everything (every checkbox renders
  // checked). `[]` is a DIFFERENT, deliberate state — the registrar
  // unchecked every box, so nothing of that axis should show. Collapsing
  // "show everything" and "show nothing" onto the same empty-array value
  // was a real bug (unchecking the last box would have silently snapped
  // back to "everything checked") — null vs [] is what keeps them distinct.
  dayTypes: DayType[] | null;
  categories: EventCategory[] | null;
  level: Audience; // 'all' | 'primary' | 'secondary'
  status: StatusFilter;
  // Reserved for the registrar's #2 filters (spec D3). Add keys here + a
  // CALENDAR_FILTERS entry + a control in calendar-filter-bar.
};

export function defaultFilterState(): CalendarFilterState {
  return {
    from: null,
    to: null,
    dayTypes: null,
    categories: null,
    level: 'all',
    status: 'all',
  };
}

// ─── Multi-select checklist helpers (Day types, Event category) ──────────────
//
// Both `dayTypes` and `categories` use "null = show everything" as their
// FILTER semantics (see filterDays/filterEvents above) — a checklist UI must
// show every box CHECKED in that state, not every box unchecked (an
// unchecked box reads as "hidden," the opposite of what null means). These
// two helpers are the single source for that checked-state + toggle logic,
// shared by calendar-sidebar.tsx's Day types checklist and
// calendar-filter-bar.tsx's Event category checklist so the two can't drift
// onto different (buggy) semantics independently.

/** Whether `value`'s checkbox should render checked, given the filter's
 * current explicit list (null = everything is implicitly checked). */
export function isMultiFilterChecked<T>(
  current: T[] | null,
  value: T
): boolean {
  return current === null || current.includes(value);
}

/** Returns the next explicit list after toggling `value`, treating a null
 * `current` as "every value in `allValues` is currently checked." Collapses
 * back to `null` (show-all) when the result would include every value
 * again — but an explicit empty list (every box unchecked, "show nothing")
 * is preserved as `[]`, never conflated with `null`. */
export function toggleMultiFilterValue<T>(
  allValues: readonly T[],
  current: T[] | null,
  value: T
): T[] | null {
  const effective = current === null ? [...allValues] : current;
  const next = effective.includes(value)
    ? effective.filter((v) => v !== value)
    : [...effective, value];
  return next.length === allValues.length ? null : next;
}

/** True when any filter axis narrows the view away from the default (every
 * axis untouched). Drives the "no days or events match your filters" empty
 * state in MonthView — a genuinely-empty term (e.g. a school break with
 * zero events) must NOT show that message, only a filter-caused emptiness
 * should. */
export function hasActiveCalendarFilters(s: CalendarFilterState): boolean {
  return (
    s.from !== null ||
    s.to !== null ||
    s.dayTypes !== null ||
    s.categories !== null ||
    s.level !== 'all' ||
    s.status !== 'all'
  );
}

function inLevel(rowAudience: Audience, level: Audience): boolean {
  return level === 'all'
    ? true
    : rowAudience === 'all' || rowAudience === level;
}

export function filterEvents(
  events: CalendarEventRow[],
  s: CalendarFilterState
): CalendarEventRow[] {
  return events.filter((e) => {
    if (s.from && e.endDate < s.from) return false; // event ends before window
    if (s.to && e.startDate > s.to) return false; // event starts after window
    if (s.categories !== null && !s.categories.includes(e.category))
      return false;
    if (!inLevel(e.audience, s.level)) return false;
    return true;
  });
}

export function filterDays(
  days: SchoolCalendarRow[],
  s: CalendarFilterState
): SchoolCalendarRow[] {
  return days.filter((d) => {
    if (s.from && d.date < s.from) return false;
    if (s.to && d.date > s.to) return false;
    if (s.dayTypes !== null && !s.dayTypes.includes(d.dayType)) return false;
    if (!inLevel(d.audience, s.level)) return false;
    if (s.status !== 'all') {
      const open = isEncodableDayType(d.dayType, d.hblOverlay);
      if (s.status === 'open' && !open) return false;
      if (s.status === 'closed' && open) return false;
    }
    return true;
  });
}

// Registry — drives calendar-filter-bar rendering + makes adding the #2
// filters (spec D3) a one-entry change. `id` is the anchor state key for the
// control; the `date-range` control is the one exception — it owns BOTH `from`
// and `to` (anchored on `from`), so its renderer writes the pair from a single
// widget. Every other control maps 1:1 to its `id`.
//
// `level` (Audience) and `dayTypes` are deliberately NOT in this registry —
// each has its own always-visible sidebar control in calendar-sidebar.tsx
// (Audience = segmented toggle, Day types = a checklist under the
// mini-calendar) rather than living one click deep in this popover. Both
// still live on CalendarFilterState and are applied by filterDays/
// filterEvents exactly like every other axis below.
export type CalendarFilterDef = {
  id: keyof CalendarFilterState;
  label: string;
  control: 'date-range' | 'category-multi' | 'status';
};

export const CALENDAR_FILTERS: CalendarFilterDef[] = [
  { id: 'from', label: 'Date range', control: 'date-range' }, // drives from + to
  { id: 'categories', label: 'Event category', control: 'category-multi' },
  { id: 'status', label: 'Status', control: 'status' },
];
