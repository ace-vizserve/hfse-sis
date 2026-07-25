import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MiniCalendar } from '@/components/attendance/calendar/mini-calendar';
import type { CalendarIndex } from '@/components/attendance/calendar/hooks/use-calendar-index';

function emptyIndex(): CalendarIndex {
  return {
    entriesByIso: new Map(),
    eventsByIso: new Map(),
    hasRowByIso: new Set(),
  };
}

describe('MiniCalendar', () => {
  it('renders the month label for the cursor month', () => {
    render(
      <MiniCalendar
        cursor={new Date(2026, 6, 1)} // July 2026
        onCursor={() => {}}
        index={emptyIndex()}
      />
    );
    expect(screen.getByText('July 2026')).toBeInTheDocument();
  });

  it('shows a density dot only on dates that have an entry in the index', () => {
    const index = emptyIndex();
    index.entriesByIso.set('2026-07-15', [
      { key: 'a', label: 'Term exam', color: 'very-stale' },
    ]);
    render(
      <MiniCalendar
        cursor={new Date(2026, 6, 1)}
        onCursor={() => {}}
        index={index}
      />
    );
    const day15 = screen.getByLabelText('2026-07-15');
    const day16 = screen.getByLabelText('2026-07-16');
    expect(day15.querySelector('span > span')).not.toBeNull();
    expect(day16.querySelector('span > span')).toBeNull();
  });

  it('clicking a date moves the shared cursor to that exact date', () => {
    const onCursor = vi.fn();
    render(
      <MiniCalendar
        cursor={new Date(2026, 6, 1)}
        onCursor={onCursor}
        index={emptyIndex()}
      />
    );
    fireEvent.click(screen.getByLabelText('2026-07-15'));
    expect(onCursor).toHaveBeenCalledWith(new Date(2026, 6, 15));
  });

  it('prev/next move the cursor one month back/forward', () => {
    const onCursor = vi.fn();
    render(
      <MiniCalendar
        cursor={new Date(2026, 6, 1)}
        onCursor={onCursor}
        index={emptyIndex()}
      />
    );
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(onCursor).toHaveBeenCalledWith(new Date(2026, 7, 1));
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(onCursor).toHaveBeenCalledWith(new Date(2026, 5, 1));
  });
});
