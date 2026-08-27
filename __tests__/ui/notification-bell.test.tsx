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

// ⚠ THE MOCK IS URL-AWARE, and it has to be. The bell now fetches TWO
// endpoints and merges them. A mock that answers every URL with the same body
// hands change-request rows to the declaration branch — which is exactly what
// happened, and it crashed the panel on a missing date rather than failing an
// assertion.
const CHANGE_REQUEST_ROW = {
  id: 'cr-1',
  field_changed: 'ww_scores',
  reason_category: 'regrading',
  requested_at: '2026-08-20T08:00:00.000Z',
  grading_sheet_id: 'sheet-1',
  grade_entry_id: 'entry-1',
  student_label: 'Tan, Grace (STU-001)',
  sheet_label: 'P4 Obedience · English · Term 1',
};

const DECLARATION_ROW = {
  id: 'dec-1',
  request_id: 'areq-9',
  student_label: 'Lim, Wei (STU-014)',
  kind: 'absence' as const,
  start_date: '2026-09-03',
  end_date: '2026-09-05',
  // Newer than the change request above, so it must sort first.
  filed_at: '2026-08-26T02:00:00.000Z',
};

let declarationRows: unknown[] = [DECLARATION_ROW];
let changeRequestRows: unknown[] = [CHANGE_REQUEST_ROW];

const fetchMock = vi.fn(async (...args: unknown[]) => {
  const url = String(args[0] ?? '');
  if (url.includes('/api/declarations/preview')) {
    return { rows: declarationRows };
  }
  return { rows: changeRequestRows };
});
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
  declarationRows = [DECLARATION_ROW];
  changeRequestRows = [CHANGE_REQUEST_ROW];
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

  it('opens the panel, lazy-fetches, and renders a row on click', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="school_admin" userId="u-1" initialCount={1} />
    );

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    // Two sources now, fetched together when the panel opens.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/change-requests/preview',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/declarations/preview',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(
      await screen.findByText(/Tan, Grace \(STU-001\)/)
    ).toBeInTheDocument();

    const rowLink = screen.getByRole('link', { name: /Tan, Grace/i });
    expect(rowLink).toHaveAttribute(
      'href',
      '/markbook/change-requests?req=cr-1'
    );

    await user.click(rowLink);

    await waitFor(() =>
      expect(
        screen.queryByText(/Tan, Grace \(STU-001\)/)
      ).not.toBeInTheDocument()
    );
  });

  // Fix 1 regression coverage: /markbook/change-requests (the deep-link
  // every other gate role gets) redirects teachers away
  // (app/(markbook)/markbook/change-requests/page.tsx is gated to
  // school_admin | superadmin | academic_coordinator) — a teacher's row
  // must link to their own reachable list page instead
  // (/markbook/grading/requests, "My Requests" per lib/auth/roles.ts),
  // with no ?req= deep-link since that page doesn't read one.
  it('a teacher row links to /markbook/grading/requests, not the change-requests deep-link', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="teacher" userId="u-1" initialCount={1} />
    );

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    const rowLink = await screen.findByRole('link', { name: /Tan, Grace/i });
    expect(rowLink).toHaveAttribute('href', '/markbook/grading/requests');
  });

  it.each(['school_admin', 'superadmin', 'academic_coordinator'] as const)(
    '%s row still links to the /markbook/change-requests deep-link',
    async (role) => {
      const user = userEvent.setup();
      renderWithClient(
        <NotificationBell role={role} userId="u-1" initialCount={1} />
      );

      await user.click(screen.getByRole('button', { name: /notifications/i }));

      const rowLink = await screen.findByRole('link', {
        name: /Tan, Grace/i,
      });
      expect(rowLink).toHaveAttribute(
        'href',
        '/markbook/change-requests?req=cr-1'
      );
    }
  );
});

/**
 * The bell carries two sources as of 2026-08-27.
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
      screen.getByRole('button', { name: 'Notifications' })
    ).toBeInTheDocument();
  });

  it('lists a declaration and links it to the filing', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell
        role="teacher"
        userId="u-1"
        initialCount={0}
        initialDeclarationCount={1}
      />
    );

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    const rowLink = await screen.findByRole('link', { name: /Lim, Wei/i });
    expect(rowLink).toHaveAttribute(
      'href',
      '/attendance/declarations?req=areq-9'
    );
    // It says what it is and who sent it — this is the one thing on the bell
    // that a parent started rather than a colleague.
    expect(screen.getByText(/Filed by a parent/)).toBeInTheDocument();
    expect(screen.getByText(/absence 3–5 Sep/)).toBeInTheDocument();
  });

  it('puts the newest first regardless of which source it came from', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell
        role="school_admin"
        userId="u-1"
        initialCount={1}
        initialDeclarationCount={1}
      />
    );

    await user.click(screen.getByRole('button', { name: /notifications/i }));
    await screen.findByRole('link', { name: /Lim, Wei/i });

    const links = screen.getAllByRole('link');
    // The declaration was filed later than the change request.
    expect(links[0]).toHaveAttribute(
      'href',
      '/attendance/declarations?req=areq-9'
    );
  });

  it('still shows grade changes when the declaration endpoint fails', async () => {
    // ⚠ An empty bell reads as "nothing waiting", which is a worse answer than
    // a shorter list. One source being down must not blank the other.
    fetchMock.mockImplementationOnce(async () => ({
      rows: changeRequestRows,
    }));
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('declarations are down');
    });

    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="school_admin" userId="u-1" initialCount={1} />
    );

    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(
      await screen.findByText(/Tan, Grace \(STU-001\)/)
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
