/**
 * Behavior test for the calendar EventEditorDialog.
 *
 * Tier-2 mutation contract (via useMutation/apiFetch):
 *  - pending → Save disabled; success → toast.success + onCreated; error →
 *    route-specific message preserved (not flattened) and onCreated never runs.
 *
 * Date-based behavior (2026-06-15):
 *  - today/future date → saves directly, no warning;
 *  - past date → editable, but a warning confirm fires first; the change only
 *    goes through after "Save anyway".
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

// Default type is `public_holiday` (day-target, no label required). A far-future
// seed date means save() passes straight through without the past-date warning.
const FUTURE_PROPS = {
  open: true,
  termId: 'term-1',
  defaultStart: '2099-12-31',
  defaultEnd: '2099-12-31',
  defaultAudience: 'all' as const,
  editing: null,
};

function saveButton() {
  return screen.getByRole('button', { name: /^save$/i });
}

describe('EventEditorDialog', () => {
  it('disables Save while pending, then toasts success + calls onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();

    let resolve: (r: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((res) => {
          resolve = res;
        })
    );

    renderWithClient(
      <EventEditorDialog
        {...FUTURE_PROPS}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(onCreated).not.toHaveBeenCalled();

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
        {...FUTURE_PROPS}
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await user.click(saveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('day_type_not_encodable')
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('a past date warns first and does not save until confirmed', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );

    renderWithClient(
      <EventEditorDialog
        {...FUTURE_PROPS}
        defaultStart="2000-01-01"
        defaultEnd="2000-01-01"
        onClose={vi.fn()}
        onCreated={onCreated}
      />
    );

    await user.click(saveButton());

    // Warning shown; nothing saved yet.
    expect(
      await screen.findByText(/this date has already passed/i)
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    // Confirm → the save goes through.
    await user.click(screen.getByRole('button', { name: /save anyway/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('flags a past-date change as pastDateOverride in the request body', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );

    // An informational event (Exam) so the request hits the events route.
    renderWithClient(
      <EventEditorDialog
        {...FUTURE_PROPS}
        defaultStart="2000-01-01"
        defaultEnd="2000-01-01"
        editing={
          {
            id: 'evt-1',
            startDate: '2000-01-01',
            endDate: '2000-01-01',
            label: 'Old exam',
            category: 'term_exam',
            audience: 'all',
            tentative: false,
          } as never
        }
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    // Edit mode → button reads "Update".
    await user.click(screen.getByRole('button', { name: /^update$/i }));
    await user.click(screen.getByRole('button', { name: /save anyway/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.pastDateOverride).toBe(true);
  });
});
