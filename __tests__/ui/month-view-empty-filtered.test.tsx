import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MonthView } from '@/components/attendance/calendar/views/month-view';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';

function emptyIndex(): CalendarIndex {
  return {
    entriesByIso: new Map(),
    eventsByIso: new Map(),
    hasRowByIso: new Set(),
  };
}

const term = { startDate: '2026-01-01', endDate: '2026-12-31' };
const july2026 = new Date(2026, 6, 1);

describe('MonthView — empty-filtered state', () => {
  it('shows the "no days or events match" message when filters are active and the visible month has zero chips', () => {
    render(
      <MonthView
        term={term}
        index={emptyIndex()}
        cursor={july2026}
        onCursor={() => {}}
        selectedIsos={new Set()}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.getByText('No days or events match the current filters.')
    ).toBeInTheDocument();
    // The day grid itself is replaced, not just overlaid — no day-number
    // cells rendered (a real cell's button carries a "Today" title attr
    // regardless, but the weekday-header + Today nav button stay, so check
    // there are zero clickable day cells instead).
    expect(
      screen.queryByRole('button', { name: '15' })
    ).not.toBeInTheDocument();
  });

  it('does NOT show the empty-filtered message when no filters are active, even with zero chips (a genuinely quiet month)', () => {
    render(
      <MonthView
        term={term}
        index={emptyIndex()}
        cursor={july2026}
        onCursor={() => {}}
        selectedIsos={new Set()}
        onDayClick={() => {}}
        filtersActive={false}
      />
    );
    expect(
      screen.queryByText('No days or events match the current filters.')
    ).not.toBeInTheDocument();
  });

  it('does NOT show the empty-filtered message when filters are active but the month still has a matching chip', () => {
    const index = emptyIndex();
    index.entriesByIso.set('2026-07-15', [
      { key: 'a', label: 'PTC', color: 'chart-5' },
    ]);
    render(
      <MonthView
        term={term}
        index={index}
        cursor={july2026}
        onCursor={() => {}}
        selectedIsos={new Set()}
        onDayClick={() => {}}
        filtersActive
      />
    );
    expect(
      screen.queryByText('No days or events match the current filters.')
    ).not.toBeInTheDocument();
  });
});
