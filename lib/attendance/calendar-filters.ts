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
  dayTypes: DayType[]; // empty = all
  categories: EventCategory[]; // empty = all
  level: Audience; // 'all' | 'primary' | 'secondary' — surfaced as its own
  // always-visible sidebar control (calendar-sidebar.tsx), not the Filters
  // popover, but still lives on this shared state object since filterDays/
  // filterEvents apply it the same way as every other axis here.
  status: StatusFilter;
  // Reserved for the registrar's #2 filters (spec D3). Add keys here + a
  // CALENDAR_FILTERS entry + a control in calendar-filter-bar.
};

export function defaultFilterState(): CalendarFilterState {
  return {
    from: null,
    to: null,
    dayTypes: [],
    categories: [],
    level: 'all',
    status: 'all',
  };
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
    if (s.categories.length > 0 && !s.categories.includes(e.category))
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
    if (s.dayTypes.length > 0 && !s.dayTypes.includes(d.dayType)) return false;
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
// `level` (Audience) is deliberately NOT in this registry — it has its own
// always-visible segmented control in calendar-sidebar.tsx rather than living
// one click deep in this popover, so it isn't rendered here. It still lives
// on CalendarFilterState and is applied by filterDays/filterEvents exactly
// like every other axis below.
export type CalendarFilterDef = {
  id: keyof CalendarFilterState;
  label: string;
  control: 'date-range' | 'day-type-multi' | 'category-multi' | 'status';
};

export const CALENDAR_FILTERS: CalendarFilterDef[] = [
  { id: 'from', label: 'Date range', control: 'date-range' }, // drives from + to
  { id: 'dayTypes', label: 'Day type', control: 'day-type-multi' },
  { id: 'categories', label: 'Event category', control: 'category-multi' },
  { id: 'status', label: 'Status', control: 'status' },
];
