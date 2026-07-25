import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WeekView } from '@/components/attendance/calendar/views/week-view';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';

function emptyIndex(): CalendarIndex {
  return {
    entriesByIso: new Map(),
    eventsByIso: new Map(),
    hasRowByIso: new Set(),
  };
}

const term = { startDate: '2026-01-01', endDate: '2026-12-31' };
// A Monday, so mondayOf(cursor) lands on the same date — 2026-07-13.
const mondayInJuly = new Date(2026, 6, 13);

describe('WeekView — empty-filtered state', () => {
  it('shows the "no days or events match" message when filters are active and the visible week has zero chips', () => {
    render(
      <WeekView
        term={term}
        index={emptyIndex()}
        cursor={mondayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.getByText('No days or events match the current filters.')
    ).toBeInTheDocument();
  });

  it('does NOT show the empty-filtered message when no filters are active, even with zero chips', () => {
    render(
      <WeekView
        term={term}
        index={emptyIndex()}
        cursor={mondayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive={false}
      />
    );
    expect(
      screen.queryByText('No days or events match the current filters.')
    ).not.toBeInTheDocument();
  });

  it('does NOT show the empty-filtered message when filters are active but the week still has a matching chip', () => {
    const index = emptyIndex();
    index.entriesByIso.set('2026-07-15', [
      { key: 'a', label: 'PTC', color: 'chart-5' },
    ]);
    render(
      <WeekView
        term={term}
        index={index}
        cursor={mondayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.queryByText('No days or events match the current filters.')
    ).not.toBeInTheDocument();
  });
});
