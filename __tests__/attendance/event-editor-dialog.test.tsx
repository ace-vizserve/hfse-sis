/**
 * Behavior test for the Tier-2 mutation reference in the attendance module:
 * the calendar EventEditorDialog. Saving routes through useMutation (apiFetch),
 * so we assert the three contracts:
 *  - pending → the Save button is disabled while the request is in flight
 *  - success → toast.success fires and onCreated() runs (the parent's refresh
 *    proxy — the dialog itself doesn't call router.refresh)
 *  - error   → the route-specific message is preserved (ApiError.message ===
 *    body.error), NOT flattened to a generic string, and onCreated never runs.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventEditorDialog } from '@/components/attendance/calendar/event-editor-dialog';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { toastSuccess, toastError, toastInfo, toastWarning } = vi.hoisted(
  () => ({
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastWarning: vi.fn(),
  })
);

// EventEditorDialog doesn't use next/navigation, but mirror the reference
// setup so the mock surface matches the other Tier-2 tests.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/sis/calendar',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
    warning: toastWarning,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const BASE_PROPS = {
  open: true,
  termId: 'term-1',
  termStart: '2026-01-01',
  termEnd: '2026-03-31',
  // Default type is `public_holiday` (a day-target, no label required); seed
  // dates inside the term window so save() passes its client validation.
  defaultStart: '2026-02-10',
  defaultEnd: '2026-02-10',
  defaultAudience: 'all' as const,
  editing: null,
};

function saveButton() {
  return screen.getByRole('button', { name: /^save$/i });
}

describe('EventEditorDialog (Tier-2 mutation)', () => {
  it('disables Save while pending, then toasts success + calls onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();

    // Hold the response open so we can observe the pending (disabled) state.
    let resolve: (r: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((res) => {
          resolve = res;
        })
    );

    renderWithClient(
      <EventEditorDialog
        {...BASE_PROPS}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await user.click(saveButton());

    // Pending: the button is disabled and onCreated hasn't fired yet.
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(onCreated).not.toHaveBeenCalled();

    // Resolve the request → success side-effects fire.
    resolve(jsonResponse({ ok: true }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('preserves the route-specific error message and does not call onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();

    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'day_type_not_encodable' }, 409))
    );

    renderWithClient(
      <EventEditorDialog
        {...BASE_PROPS}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await user.click(saveButton());

    // The exact body.error wording is surfaced — not flattened to a generic.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('day_type_not_encodable')
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});
