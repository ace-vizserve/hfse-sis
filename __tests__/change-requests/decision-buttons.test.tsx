/**
 * Bespoke-error reference test for the ChangeRequestDecisionButtons Tier-2
 * mutation. The concurrent-decision race (409) is NOT a generic error — it
 * closes the dialog, refreshes, and shows an "Already handled" toast whose
 * description is the route's specific message. The success path toasts the
 * action-specific copy and refreshes.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChangeRequestDecisionButtons } from '@/app/(markbook)/markbook/change-requests/decision-buttons';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/markbook/change-requests',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Open the approve dialog and click its Confirm ("Approve") button.
async function approveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  // Trigger button (row action) — scope to the small one.
  const triggers = screen.getAllByRole('button', { name: /^approve$/i });
  await user.click(triggers[0]);
  // Dialog mounts; click the footer Confirm (also labelled "Approve").
  await waitFor(() =>
    expect(screen.getByText(/approve this request\?/i)).toBeInTheDocument()
  );
  const confirms = screen.getAllByRole('button', { name: /^approve$/i });
  // The last "Approve" is the dialog confirm button.
  await user.click(confirms[confirms.length - 1]);
}

describe('ChangeRequestDecisionButtons (bespoke 409 concurrent race)', () => {
  it('409 surfaces the route-specific "already handled" message, closes the dialog, and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: 'Another administrator already actioned this request.' },
          409
        )
      )
    );
    renderWithClient(<ChangeRequestDecisionButtons requestId="cr-1" />);

    await approveAndConfirm(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Already handled', {
        description: 'Another administrator already actioned this request.',
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // Dialog closed.
    await waitFor(() =>
      expect(
        screen.queryByText(/approve this request\?/i)
      ).not.toBeInTheDocument()
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('success path toasts "Request approved" and refreshes', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    renderWithClient(<ChangeRequestDecisionButtons requestId="cr-1" />);

    await approveAndConfirm(user);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Request approved')
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
