import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CalendarCell } from '@/components/attendance/calendar/calendar-cell';

// Real CalendarCellProps shape (components/attendance/calendar/calendar-cell.tsx)
// is FLAT — iso/dayNumber/chips/isToday/... directly on the component, not
// nested under a `cell` key.

describe('CalendarCell — missingRow', () => {
  it('renders an "Unmarked" tag when missingRow is true', () => {
    render(
      <CalendarCell
        iso="2026-07-23"
        dayNumber={23}
        chips={[]}
        isToday={false}
        clickable
        missingRow
        onClick={() => {}}
      />
    );
    expect(screen.getByText('Unmarked')).toBeInTheDocument();
  });

  it('renders nothing extra when missingRow is false', () => {
    render(
      <CalendarCell
        iso="2026-07-17"
        dayNumber={17}
        chips={[]}
        isToday={false}
        clickable
        missingRow={false}
        onClick={() => {}}
      />
    );
    expect(screen.queryByText('Unmarked')).not.toBeInTheDocument();
  });

  it('renders nothing extra when missingRow is absent (default)', () => {
    render(
      <CalendarCell
        iso="2026-07-17"
        dayNumber={17}
        chips={[]}
        isToday={false}
        clickable
        onClick={() => {}}
      />
    );
    expect(screen.queryByText('Unmarked')).not.toBeInTheDocument();
  });
});
