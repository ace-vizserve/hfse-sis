import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DayView } from '@/components/attendance/calendar/views/day-view';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';

function emptyIndex(): CalendarIndex {
  return {
    entriesByIso: new Map(),
    eventsByIso: new Map(),
    hasRowByIso: new Set(),
  };
}

const term = { startDate: '2026-01-01', endDate: '2026-12-31' };
// A Wednesday (not a weekend), so the baseline message is the "School day"
// copy rather than "Weekend" — isolates the filtersActive branch cleanly.
const wednesdayInJuly = new Date(2026, 6, 15);

describe('DayView — empty-filtered state', () => {
  it('shows the filtered message instead of the generic "nothing scheduled" copy when filters are active', () => {
    render(
      <DayView
        term={term}
        index={emptyIndex()}
        cursor={wednesdayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.getByText('No days or events match the current filters.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('School day — nothing scheduled.')
    ).not.toBeInTheDocument();
  });

  it('shows the generic "nothing scheduled" copy when no filters are active', () => {
    render(
      <DayView
        term={term}
        index={emptyIndex()}
        cursor={wednesdayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive={false}
      />
    );
    expect(
      screen.getByText('School day — nothing scheduled.')
    ).toBeInTheDocument();
  });

  it('shows neither empty message when the day actually has a chip', () => {
    const index = emptyIndex();
    index.entriesByIso.set('2026-07-15', [
      { key: 'a', label: 'PTC', color: 'chart-5' },
    ]);
    render(
      <DayView
        term={term}
        index={index}
        cursor={wednesdayInJuly}
        onCursor={() => {}}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.queryByText('No days or events match the current filters.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('School day — nothing scheduled.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('PTC')).toBeInTheDocument();
  });
});
