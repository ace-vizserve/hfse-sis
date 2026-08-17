/**
 * Behavior test for the write reference in the evaluation module: the
 * virtue-themes editor (`PATCH /api/evaluation/virtue-theme`). Proves:
 *  - while the save is in flight, the Save button is disabled and nothing has
 *    been claimed yet;
 *  - on success, router.refresh() is awaited and the toast lands AFTER it, and
 *    the baseline updates so the button disables again;
 *  - on an error response, the *route-specific* message is surfaced (not a
 *    flattened generic one) and no refresh happens.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/evaluation/virtue-themes',
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

const TERMS = [
  {
    id: 'term-1',
    label: 'Term 1',
    termNumber: 1,
    startDate: '2026-01-06',
    endDate: '2026-03-20',
    virtueTheme: '',
  },
];

function saveButton() {
  // Matches both the idle "Save" label and the in-flight "Saving…" label.
  return screen.getByRole('button', { name: /sav/i });
}

describe('VirtueThemesEditor (Tier-2 mutation)', () => {
  it('disables Save while pending, then refreshes + toasts on success', async () => {
    const user = userEvent.setup();

    // A deferred response so we can observe the pending (disabled) state.
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolve = res;
    });
    stubFetch(() => pending);

    renderWithClient(<VirtueThemesEditor terms={TERMS} />);

    // Initially clean → Save disabled.
    expect(saveButton()).toBeDisabled();

    // Type a value → dirty → Save enabled.
    await user.type(screen.getByLabelText(/virtue theme/i), 'Faith');
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());

    // In flight → disabled.
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(toastSuccess).not.toHaveBeenCalled();

    // Resolve the request.
    resolve(jsonResponse({ ok: true }));

    // The toast is the LAST step — it waits on the refresh, so waiting for the
    // refresh alone would race it.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Term 1 virtue theme saved')
    );
    expect(refreshMock).toHaveBeenCalled();
    // Baseline updated → no longer dirty → Save disabled again.
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it('surfaces the route-specific error message and does not refresh', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'term not found' }, 404))
    );

    renderWithClient(<VirtueThemesEditor terms={TERMS} />);

    await user.type(screen.getByLabelText(/virtue theme/i), 'Faith');
    await user.click(saveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('term not found')
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // Still dirty (save failed) → Save comes back enabled for a retry. The
    // in-flight flag clears just after the error toast, so this waits.
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });
});
