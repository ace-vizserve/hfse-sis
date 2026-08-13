/**
 * Bespoke-error reference test for the LockToggle Tier-2 mutation.
 *
 * The two 409 break-glass codes are NOT generic errors — each opens a distinct
 * confirm dialog with route-specific copy, never a generic toast:
 *   - `grading_lock_date_passed`  → "Grading deadline has passed" dialog
 *   - `pending_change_requests`   → "Pending change requests block this unlock"
 * These tests prove the route-specific message surfaces (not a generic one) and
 * that no error toast fires for those codes. The success path toasts + refreshes.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LockToggle } from '@/components/grading/lock-toggle';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/markbook/grading/sheet-1',
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

// Click the top-level toggle button, then confirm in the AlertDialog so
// runToggle() actually fires.
async function clickUnlockAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /unlock sheet/i }));
  // The confirm dialog's action button is "Unlock".
  const confirm = await screen.findByRole('button', { name: /^unlock$/i });
  await user.click(confirm);
}

describe('LockToggle (bespoke 409 break-glass codes)', () => {
  it('409 grading_lock_date_passed opens the deadline dialog with the term label, not a generic toast', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: 'grading_lock_date_passed',
            termLabel: 'Term 2',
            lockDate: '2026-03-15',
          },
          409
        )
      )
    );
    renderWithClient(<LockToggle sheetId="sheet-1" isLocked />);

    await clickUnlockAndConfirm(user);

    // Route-specific dialog appears with the term label — NOT a generic toast.
    await waitFor(() =>
      expect(
        screen.getByText(/grading deadline has passed/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText('Term 2')).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('409 pending_change_requests opens the distinct pending-CR dialog with its count, not a generic toast', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(
        jsonResponse({ error: 'pending_change_requests', pendingCount: 3 }, 409)
      )
    );
    renderWithClient(<LockToggle sheetId="sheet-1" isLocked />);

    await clickUnlockAndConfirm(user);

    await waitFor(() =>
      expect(
        screen.getByText(/pending change requests block this unlock/i)
      ).toBeInTheDocument()
    );
    // The distinct message carries the count — proves it's the CR dialog, not
    // the deadline one, and not a generic message.
    expect(screen.getByText(/3 pending change requests/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/grading deadline has passed/i)
    ).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('success path toasts and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(<LockToggle sheetId="sheet-1" isLocked />);

    await clickUnlockAndConfirm(user);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Sheet unlocked')
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
