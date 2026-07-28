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

const fetchMock = vi.fn(async (..._args: unknown[]) => ({
  rows: [
    {
      id: 'cr-1',
      field_changed: 'ww_scores',
      reason_category: 'regrading',
      requested_at: new Date().toISOString(),
      grading_sheet_id: 'sheet-1',
      grade_entry_id: 'entry-1',
      student_label: 'Tan, Grace (STU-001)',
      sheet_label: 'P4 Obedience · English · Term 1',
    },
  ],
}));
vi.mock('@/lib/query/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/fetcher')>();
  return { ...actual, apiFetch: (...args: unknown[]) => fetchMock(...args) };
});

import {
  NotificationBell,
  deriveInitials,
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

  it('opens the panel, lazy-fetches, and renders a row on click', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="school_admin" userId="u-1" initialCount={1} />
    );

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/change-requests/preview',
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
