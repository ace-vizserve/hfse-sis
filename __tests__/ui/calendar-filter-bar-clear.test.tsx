import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CalendarFilterBar } from '@/components/attendance/calendar/calendar-filter-bar';
import type { CalendarFilterState } from '@/lib/attendance/calendar-filters';

describe('CalendarFilterBar — Clear filters button', () => {
  it('resets only date range, event category, and status — leaves dayTypes and level untouched', () => {
    const value: CalendarFilterState = {
      from: '2026-04-01',
      to: '2026-04-30',
      dayTypes: ['hbl'],
      categories: ['ptc'],
      level: 'primary',
      status: 'open',
    };
    const onChange = vi.fn();
    render(<CalendarFilterBar value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onChange).toHaveBeenCalledWith({
      from: null,
      to: null,
      dayTypes: ['hbl'], // unchanged — this popover doesn't own it
      categories: null,
      level: 'primary', // unchanged — this popover doesn't own it
      status: 'all',
    });
  });
});
