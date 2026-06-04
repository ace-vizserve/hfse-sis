'use client';

// useCalendarViewState — tiny client hook holding the operational calendar's
// view-level UI state: which view is active, which month the grid is showing,
// and the active filter state. The orchestrator owns the data; this hook owns
// the transient view chrome.
//
// Phase 1 scope: no multi-select / selection set (the orchestrator passes an
// empty Set to MonthView). Add a `selected` slice here when bulk-classify
// returns in a later task.

import { useState } from 'react';

import type { CalendarView } from '@/components/attendance/calendar/calendar-toolbar';
import {
  defaultFilterState,
  type CalendarFilterState,
} from '@/lib/attendance/calendar-filters';

export type CalendarViewState = {
  view: CalendarView;
  setView: (v: CalendarView) => void;
  cursor: Date;
  setCursor: (d: Date) => void;
  filterState: CalendarFilterState;
  setFilterState: (next: CalendarFilterState) => void;
};

export function useCalendarViewState(initialCursor: Date): CalendarViewState {
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState<Date>(initialCursor);
  const [filterState, setFilterState] = useState<CalendarFilterState>(() =>
    defaultFilterState()
  );

  return {
    view,
    setView,
    cursor,
    setCursor,
    filterState,
    setFilterState,
  };
}
