/**
 * Behavior test for the Tier-2 mutation: the SIS AY-setup "Accepting
 * applications" Switch. No local optimistic value — the Switch reflects the
 * server-provided `current` prop; a flip mutates then router.refresh()es.
 *  - while the request is in flight, the Switch is disabled (isPending)
 *  - success → toast.success + router.refresh
 *  - error → the route-specific message (body.error) surfaces, no refresh
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function theSwitch() {
  return screen.getByRole('switch', {
    name: /accepting applications for AY9999/i,
  });
}

describe('AyAcceptingApplicationsToggle (Tier-2)', () => {
  it('disables the switch while the request is in flight, then refreshes on success', async () => {
    const user = userEvent.setup();

    // A deferred fetch so we can observe the pending (disabled) state.
    let resolveFetch: (r: Response) => void = () => {};
    const fetchSpy = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    renderWithClient(
      <AyAcceptingApplicationsToggle
        ayCode="AY9999"
        current={false}
        isCurrentAy={false}
      />
    );

    const sw = theSwitch();
    expect(sw).not.toBeDisabled();

    await user.click(sw);

    // In flight → disabled.
    await waitFor(() => expect(theSwitch()).toBeDisabled());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // PATCH to the accepting-applications route with the next value.
    const [, init] = fetchSpy.mock.calls[0];
    expect(fetchSpy.mock.calls[0][0]).toContain(
      '/api/sis/ay-setup/accepting-applications'
    );
    expect(init?.method).toBe('PATCH');

    // Resolve the request → success side-effects fire.
    resolveFetch(jsonResponse({ ok: true }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(
      'AY9999 is now accepting applications.'
    );
    await waitFor(() => expect(theSwitch()).not.toBeDisabled());
  });

  it('surfaces the route-specific error message and does not refresh', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'another_upcoming_ay_open' }, 409))
    );

    renderWithClient(
      <AyAcceptingApplicationsToggle
        ayCode="AY9999"
        current={false}
        isCurrentAy={false}
      />
    );

    await user.click(theSwitch());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('another_upcoming_ay_open')
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
