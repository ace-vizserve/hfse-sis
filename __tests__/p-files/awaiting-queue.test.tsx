/**
 * Behavior test for the Tier-1 OPTIMISTIC mutation in the p-files
 * document-validation awaiting queue. The list is local state mirrored from
 * RSC props (not a useQuery cache), so the optimistic target is `rows`:
 *  - approve → row removed immediately (optimistic), then refresh, THEN success
 *  - error → row is restored (rollback) and the route-specific message shows.
 *
 * The ordering matters and is the whole point of `useWriteAction`: the row goes
 * the instant it is clicked (which is why this surface passes `pending: false`),
 * but nothing CLAIMS the change until the awaited refresh has corrected the
 * server-rendered badge count behind it.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AwaitingQueue } from '@/components/p-files/document-validation/awaiting-queue';
import type { PFileValidationRow } from '@/lib/p-files/document-validation';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/p-files/document-validation',
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

const ROW: PFileValidationRow = {
  enroleeNumber: 'EN-1',
  studentNumber: null,
  fullName: 'Ada Lovelace',
  levelApplied: 'P1',
  classSection: null,
  slotKey: 'passport',
  slotLabel: 'Passport',
  fileUrl: 'https://example.test/file.pdf',
  // The queue lists every slot now; only 'Uploaded' rows carry the
  // Approve / Reject buttons these tests exercise.
  status: 'Uploaded',
  owner: 'Student',
  expiryDateIso: null,
  daysUntilExpiry: null,
};

// Groups now start CLOSED (every student carries all 21 slots, so opening
// them all buries the page), which puts the document rows — and the buttons
// these tests exercise — behind one click on the student's header.
function openStudentGroup(name: string) {
  const header = screen.getByText(name).closest('[role="button"]');
  if (!header) throw new Error(`No group header found for ${name}`);
  fireEvent.click(header);
}

function approveButton() {
  // Rows are grouped by student (expandable, KD's data-table shell); the
  // fixture has exactly one document row under one open group header, so the
  // Approve button is unambiguous without row-scoping.
  return screen.getByRole('button', { name: /approve/i });
}

describe('AwaitingQueue (Tier-1 optimistic)', () => {
  it('optimistically removes the row, toasts success, and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(<AwaitingQueue rows={[ROW]} ayCode="AY9999" isOfficer />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    openStudentGroup('Ada Lovelace');
    await user.click(approveButton());

    // Row gone (optimistic) — and at this point nothing has been claimed yet.
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
    renderWithClient(<AwaitingQueue rows={[ROW]} ayCode="AY9999" isOfficer />);

    openStudentGroup('Ada Lovelace');
    await user.click(approveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('document_locked')
    );
    // Rolled back — the row is visible again, and no refresh happened.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
