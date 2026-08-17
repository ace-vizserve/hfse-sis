/**
 * Behavior test for the Tier-1 OPTIMISTIC mutation reference: the admissions
 * document-validation queue. The list is local state mirrored from RSC props
 * (not a useQuery cache), so the optimistic target is `rows`:
 *  - approve → row removed immediately (optimistic), then refresh, THEN success
 *  - error → row is restored (rollback) and the route-specific message shows.
 *
 * The ordering is the point of `useWriteAction`: the row goes the instant it is
 * clicked (which is why this surface passes `pending: false`), but nothing
 * CLAIMS the change until the awaited refresh has corrected the badge count
 * rendered on the server behind it.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationQueue } from '@/components/admissions/document-validation/validation-queue';
import type { ValidationQueueRow } from '@/lib/admissions/document-validation';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admissions/document-validation',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ROW: ValidationQueueRow = {
  enroleeNumber: 'EN-1',
  studentNumber: null,
  fullName: 'Ada Lovelace',
  applicationStatus: 'Submitted',
  levelApplied: 'P1',
  slotKey: 'birthCert',
  slotLabel: 'Birth certificate',
  fileUrl: 'https://example.test/file.pdf',
  isExpirable: false,
  owner: 'Student',
  category: 'general',
};

function approveButton() {
  // Rows are grouped by student (expandable, KD's data-table shell); the
  // fixture has exactly one document row under one (always-expanded) group
  // header, so the Approve button is unambiguous without row-scoping.
  return screen.getByRole('button', { name: /approve/i });
}

describe('ValidationQueue (Tier-1 optimistic)', () => {
  it('optimistically removes the row, toasts success, and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate />
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await user.click(approveButton());

    // Row gone (optimistic) — at this point nothing has been claimed yet.
    await waitFor(() =>
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    );

    // The success toast is last, after the refresh it waits on.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('rolls the row back on error and shows the route-specific message', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'document_locked' }, 409))
    );
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate />
    );

    await user.click(approveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('document_locked')
    );
    // Rolled back — the row is visible again, and no refresh happened.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // The bug this prop exists to fix: the page admits `school_admin` as
  // read-only oversight (KD #74 + KD #31) while the PATCH route deliberately
  // excludes them, and this component took no viewer prop — so it rendered
  // Approve/Reject to everyone who could open the page, and every click 403'd.
  it('renders no actions when the viewer cannot validate', () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate={false} />
    );

    // The queue is still fully readable — this is oversight, not a lockout.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reject/i })
    ).not.toBeInTheDocument();
    // Triage exists only to approve or reject, so it goes too.
    expect(
      screen.queryByRole('button', { name: /triage/i })
    ).not.toBeInTheDocument();
  });

  it('omitting the prop is read-only, not editable', () => {
    // Fail-safe direction, matching KD #163's choice for row actions: a caller
    // that forgets the prop must hide the actions rather than dead-end someone
    // on a 403.
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(<ValidationQueue rows={[ROW]} ayCode="AY9999" />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
  });
});
