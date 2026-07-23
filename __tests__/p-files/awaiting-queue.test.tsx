/**
 * Behavior test for the Tier-1 OPTIMISTIC mutation in the p-files
 * document-validation awaiting queue. The list is local state mirrored from
 * RSC props (not a useQuery cache), so the optimistic target is `rows`:
 *  - approve → row removed immediately (optimistic), toast.success + refresh
 *  - error → row is restored (rollback) and the route-specific message shows.
 */
import { screen, waitFor } from '@testing-library/react';
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
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
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
  owner: 'Student',
  expiryDateIso: null,
  daysUntilExpiry: null,
};

function approveButton() {
  // Rows are grouped by student (expandable, KD's data-table shell); the
  // fixture has exactly one document row under one (always-expanded) group
  // header, so the Approve button is unambiguous without row-scoping.
  return screen.getByRole('button', { name: /approve/i });
}

describe('AwaitingQueue (Tier-1 optimistic)', () => {
  it('optimistically removes the row, toasts success, and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(<AwaitingQueue rows={[ROW]} ayCode="AY9999" isOfficer />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await user.click(approveButton());

    // Row gone (optimistic), and the success side-effects fire.
    await waitFor(() =>
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    );
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('rolls the row back on error and shows the route-specific message', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'document_locked' }, 409))
    );
    renderWithClient(<AwaitingQueue rows={[ROW]} ayCode="AY9999" isOfficer />);

    await user.click(approveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('document_locked')
    );
    // Rolled back — the row is visible again, and no refresh happened.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
