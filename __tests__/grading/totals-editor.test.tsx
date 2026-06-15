/**
 * Behavior test for the mutation pilot (Tier-2, Model A): TotalsEditor.
 * Proves the canonical useMutation conversion:
 *  - pending → submit button disabled + "Saving…"
 *  - success → toast.success + router.refresh()
 *  - error (422 body.error) → the SPECIFIC message is surfaced (preservation
 *    rule), and router.refresh() is NOT called.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TotalsEditor } from '@/components/grading/totals-editor';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderEditor() {
  return renderWithClient(
    <TotalsEditor
      sheetId="s1"
      wwTotals={[10, 10]}
      ptTotals={[10, 10, 10]}
      qaTotal={30}
      wwMaxSlots={5}
      ptMaxSlots={5}
      isLocked={false}
    />
  );
}

async function openAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /edit totals/i }));
  await user.click(await screen.findByRole('button', { name: /save totals/i }));
}

describe('TotalsEditor (mutation pilot)', () => {
  it('PATCHes, toasts success, and refreshes the route on save', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEditor();

    await openAndSave(user);

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/grading-sheets/s1/totals',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('disables the submit button and shows "Saving…" while pending', async () => {
    const user = userEvent.setup();
    let resolveFetch!: (r: Response) => void;
    stubFetch(() => new Promise<Response>((res) => (resolveFetch = res)));
    renderEditor();

    await openAndSave(user);

    const saving = await screen.findByRole('button', { name: /saving/i });
    expect(saving).toBeDisabled();

    resolveFetch(jsonResponse({ ok: true }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('preserves the route-specific error message and does not refresh', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'slot_shrink_blocked' }, 422))
    );
    renderEditor();

    await openAndSave(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('slot_shrink_blocked')
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
