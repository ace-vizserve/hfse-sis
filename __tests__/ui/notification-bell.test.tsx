import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sidebar/use-change-request-count', () => ({
  useChangeRequestCount: (
    _role: unknown,
    _userId: unknown,
    initial: number | null
  ) => initial,
}));

vi.mock('@/lib/sidebar/use-declaration-count', () => ({
  useDeclarationCount: (_userId: unknown, initial: number | null) => initial,
}));

// ⚠ Task 4 replaced the bell's own preview fetch (two endpoints, merged and
// rendered inline) with a lazily-mounted <ActivityPanel>, which owns its own
// `useInfiniteQuery` against a single GET /api/activity. The row-level
// behaviour that used to live here (per-role hrefs, source merge order,
// partial-failure resilience) now lives server-side in `lib/activity/feed.ts`
// and is covered by `__tests__/activity/feed.test.ts` and
// `__tests__/activity/events.test.ts`. What is left to verify at this layer
// is the bell itself: the gate, the badge arithmetic, and that the panel is
// genuinely lazy — it fetches nothing until the sheet opens.
const fetchMock = vi.fn(async (..._args: unknown[]) => ({
  events: [],
  nextCursor: null,
  waiting: [],
  partial: false,
  truncated: false,
}));
vi.mock('@/lib/query/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/fetcher')>();
  return { ...actual, apiFetch: (...args: unknown[]) => fetchMock(...args) };
});

import {
  NotificationBell,
  deriveInitials,
  formatDayRange,
} from '@/components/notifications/notification-bell';
import { renderWithClient } from '../_utils/render-with-client';

beforeEach(() => {
  fetchMock.mockClear();
});

describe('deriveInitials', () => {
  it('derives 2-letter initials from a well-formed "Last, First (STU-001)" label', () => {
    expect(deriveInitials('Tan, Grace (STU-001)')).toBe('TG');
  });

  it('returns the em dash placeholder for a null label', () => {
    expect(deriveInitials(null)).toBe('—');
  });

  it('does not crash on a label with no comma and produces a sensible result', () => {
    expect(() => deriveInitials('Grace')).not.toThrow();
    expect(deriveInitials('Grace')).toBe('G');
  });
});

describe('NotificationBell', () => {
  it('renders nothing for a role outside the change-request flow', () => {
    const { container } = render(
      <NotificationBell role="admissions" userId="u-1" initialCount={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count pill only when count > 0', () => {
    const { rerender } = render(
      <NotificationBell role="teacher" userId="u-1" initialCount={0} />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    rerender(<NotificationBell role="teacher" userId="u-1" initialCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens the sheet and lazy-mounts the activity panel on click', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="school_admin" userId="u-1" initialCount={1} />
    );

    // Mounted only while open (KD #56) — a closed bell must not fetch.
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /activity/i }));

    expect(await screen.findByText('Activity')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/activity'),
      expect.objectContaining({ credentials: 'include' })
    );
  });
});

/**
 * The badge carries two sources as of 2026-08-27, and Task 4 left that
 * arithmetic untouched — only the glyph and the panel behind it changed.
 *
 * Mr Ace: "the whole UI flow is the same as grade change request." An absence
 * waiting for its approver has to tap them on the shoulder the way a grade
 * change does — before this, the only way to find out was to open Attendance
 * and look.
 */
describe('NotificationBell — declarations', () => {
  it('adds the two counts together on the badge', () => {
    render(
      <NotificationBell
        role="teacher"
        userId="u-1"
        initialCount={2}
        initialDeclarationCount={3}
      />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows a declaration count on its own when there are no grade changes', () => {
    render(
      <NotificationBell
        role="teacher"
        userId="u-1"
        initialCount={0}
        initialDeclarationCount={4}
      />
    );
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides the badge when neither source is tracked', () => {
    // ⚠ `null` means "not tracked", which is not zero. Rendering a confident
    // "0 pending" for a count that never loaded is a claim we cannot make.
    render(
      <NotificationBell
        role="teacher"
        userId="u-1"
        initialCount={null}
        initialDeclarationCount={null}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Activity' })
    ).toBeInTheDocument();
  });
});

describe('formatDayRange', () => {
  it('reads one day plainly', () => {
    expect(formatDayRange('2026-09-03', '2026-09-03')).toBe('3 Sep');
  });

  it('does not repeat the month within one month', () => {
    expect(formatDayRange('2026-09-03', '2026-09-05')).toBe('3–5 Sep');
  });

  it('names both months when the range crosses one', () => {
    expect(formatDayRange('2026-09-29', '2026-10-02')).toBe('29 Sep–2 Oct');
  });

  it('returns empty rather than throwing on missing or malformed dates', () => {
    // ⚠ This bell renders in the header of EVERY page. An exception here does
    // not cost a date, it takes down whatever the person was looking at — and
    // it already did, when a test mock handed it rows with no dates at all.
    expect(formatDayRange(undefined, undefined)).toBe('');
    expect(formatDayRange(null, null)).toBe('');
    expect(() => formatDayRange('nonsense', 'nonsense')).not.toThrow();
    expect(formatDayRange('nonsense', 'nonsense')).toBe('');
  });
});
