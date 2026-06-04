import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  isEncodableDayType,
  type Audience,
  type EventCategory,
} from '@/lib/schemas/attendance';

export type StatusFilter = 'all' | 'open' | 'closed';

export type CalendarFilterState = {
  from: string | null; // yyyy-MM-dd inclusive
  to: string | null; // yyyy-MM-dd inclusive
  categories: EventCategory[]; // empty = all
  level: Audience; // 'all' | 'primary' | 'secondary'
  status: StatusFilter;
  tentativeOnly: boolean;
  // Reserved for the registrar's #2 filters (spec D3). Add keys here + a
  // CALENDAR_FILTERS entry + a control in calendar-filter-bar.
};

export function defaultFilterState(): CalendarFilterState {
  return {
    from: null,
    to: null,
    categories: [],
    level: 'all',
    status: 'all',
    tentativeOnly: false,
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
    if (s.tentativeOnly && !e.tentative) return false;
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
export type CalendarFilterDef = {
  id: keyof CalendarFilterState;
  label: string;
  control: 'date-range' | 'category-multi' | 'level' | 'status' | 'toggle';
};

export const CALENDAR_FILTERS: CalendarFilterDef[] = [
  { id: 'from', label: 'Date range', control: 'date-range' }, // drives from + to
  { id: 'categories', label: 'Category', control: 'category-multi' },
  { id: 'level', label: 'Level', control: 'level' },
  { id: 'status', label: 'Status', control: 'status' },
  { id: 'tentativeOnly', label: 'Tentative only', control: 'toggle' },
];
