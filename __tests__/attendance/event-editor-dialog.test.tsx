/**
 * Behavior test for the calendar EventEditorDialog.
 *
 * Write contract (via useWriteAction over useMutation/apiFetch):
 *  - pending → the button reads "Saving…", is disabled and aria-busy, and
 *    nothing has been claimed yet;
 *  - success → onCreated (which closes) runs first, then the toast, once the
 *    awaited refresh has landed;
 *  - error → route-specific message preserved (not flattened) and onCreated
 *    never runs.
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
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
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

/**
 * While the write is in flight the control keeps its verb and changes tense —
 * "Save" becomes "Saving…" (components/ui/button.tsx `loadingText`). So the
 * in-flight button has a DIFFERENT accessible name and cannot be found by
 * `saveButton()`.
 */
function savingButton() {
  return screen.getByRole('button', { name: /^saving/i });
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

    await waitFor(() => expect(savingButton()).toBeDisabled());
    expect(savingButton()).toHaveAttribute('aria-busy', 'true');
    expect(onCreated).not.toHaveBeenCalled();
    // Nothing is claimed while the write is still in flight.
    expect(toastSuccess).not.toHaveBeenCalled();

    resolve(jsonResponse({ ok: true }));

    // onCreated (which closes the dialog) runs first; the success toast waits
    // for the refresh behind it.
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
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

// ─── "Who is it for?" (migration 196) ─────────────────────────────────────────

// The tests that click through several Radix selects and chips run long under
// a loaded worker pool; give them room rather than let them flake.
const HEAVY_TIMEOUT = 20_000;

function typeSelect() {
  return screen.getAllByRole('combobox')[0];
}
function whoSelect() {
  return screen.getByRole('combobox', { name: /who is it for/i });
}

async function pickWho(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(whoSelect());
  await user.click(screen.getByRole('option', { name }));
}

async function pickType(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp
) {
  await user.click(typeSelect());
  await user.click(screen.getByRole('option', { name }));
}

/** Click Save and return the parsed body of the one request it sent. */
async function saveAndReadBody(
  user: ReturnType<typeof userEvent.setup>,
  fetchSpy: ReturnType<typeof stubFetch>
) {
  await user.click(saveButton());
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  const call = fetchSpy.mock.calls.find(([url]) =>
    String(url).startsWith('/api/attendance/calendar')
  );
  expect(call).toBeDefined();
  return {
    url: String(call![0]),
    body: JSON.parse((call![1] as RequestInit).body as string),
  };
}

function renderNew() {
  const fetchSpy = stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
  renderWithClient(
    <EventEditorDialog
      {...FUTURE_PROPS}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />
  );
  return { user: userEvent.setup(), fetchSpy };
}

describe('EventEditorDialog — who is it for', () => {
  it('defaults to Whole school and sends audiences [all] for a closure', async () => {
    const { user, fetchSpy } = renderNew();
    expect(whoSelect()).toHaveTextContent('Whole school');
    const { url, body } = await saveAndReadBody(user, fetchSpy);
    expect(url).toBe('/api/attendance/calendar');
    expect(body.audiences).toEqual(['all']);
    expect(body.audience).toBeUndefined();
  });

  it('a closure offers no "Specific classes…"; an informational event does', async () => {
    const { user } = renderNew();
    await user.click(whoSelect());
    expect(
      screen.getByRole('option', { name: /specific levels/i })
    ).toBeTruthy();
    expect(
      screen.queryByRole('option', { name: /specific classes/i })
    ).toBeNull();
    await user.keyboard('{Escape}');

    await pickType(user, /^exam$/i);
    await user.click(whoSelect());
    expect(
      screen.getByRole('option', { name: /specific classes/i })
    ).toBeTruthy();
  });

  it('Primary sends that half', async () => {
    const { user, fetchSpy } = renderNew();
    await pickWho(user, /^primary$/i);
    const { body } = await saveAndReadBody(user, fetchSpy);
    expect(body.audiences).toEqual(['primary']);
  });

  it('Specific levels reveals the chips and sends the picked level codes', async () => {
    const { user, fetchSpy } = renderNew();
    expect(screen.queryByRole('button', { name: 'P1' })).toBeNull();
    await pickWho(user, /specific levels/i);
    await user.click(screen.getByRole('button', { name: 'P1' }));
    await user.click(screen.getByRole('button', { name: 'S2' }));
    const { body } = await saveAndReadBody(user, fetchSpy);
    expect(body.audiences).toEqual(['P1', 'S2']);
  });

  // Never collapsed to 'primary' / 'all': those take in Youngstarters too.
  it(
    'a whole half of picked levels is still sent as those levels, not the half',
    async () => {
      const { user, fetchSpy } = renderNew();
      await pickWho(user, /specific levels/i);
      for (const c of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
        await user.click(screen.getByRole('button', { name: c }));
      }
      const { body } = await saveAndReadBody(user, fetchSpy);
      expect(body.audiences).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
      expect(body.entries).toHaveLength(1);
    },
    HEAVY_TIMEOUT
  );

  it('Specific levels with none picked asks for one and sends nothing', async () => {
    const { user, fetchSpy } = renderNew();
    await pickWho(user, /specific levels/i);
    await user.click(saveButton());
    expect(toastError).toHaveBeenCalledWith('Pick at least one level');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an informational event: Primary is levels null with that audience', async () => {
    const { user, fetchSpy } = renderNew();
    await pickType(user, /^exam$/i);
    await user.type(screen.getByLabelText(/^label/i), 'Mock exam');
    await pickWho(user, /^primary$/i);
    const { url, body } = await saveAndReadBody(user, fetchSpy);
    expect(url).toBe('/api/attendance/calendar/events');
    expect(body.audience).toBe('primary');
    expect(body.levels).toBeNull();
    expect(body.sectionIds).toBeNull();
  });

  it(
    'an informational event: Specific levels sends exactly the picked levels',
    async () => {
      const { user, fetchSpy } = renderNew();
      await pickType(user, /^exam$/i);
      await user.type(screen.getByLabelText(/^label/i), 'Mock exam');
      await pickWho(user, /specific levels/i);
      for (const c of ['S4', 'S1', 'S2', 'S3']) {
        await user.click(screen.getByRole('button', { name: c }));
      }
      const { url, body } = await saveAndReadBody(user, fetchSpy);
      expect(url).toBe('/api/attendance/calendar/events');
      expect(body.levels).toEqual(['S1', 'S2', 'S3', 'S4']);
      expect(body.sectionIds).toBeNull();
    },
    HEAVY_TIMEOUT
  );

  it('switching to a closure while "Specific classes…" is chosen goes back to Whole school', async () => {
    const { user } = renderNew();
    await pickType(user, /^exam$/i);
    await pickWho(user, /specific classes/i);
    expect(screen.getByText(/pick at least one class/i)).toBeInTheDocument();
    await pickType(user, /no class/i);
    expect(whoSelect()).toHaveTextContent('Whole school');
    expect(screen.queryByText(/pick at least one class/i)).toBeNull();
  });

  it.each([
    [{ levels: null, sectionIds: null, audience: 'primary' }, 'Primary'],
    [{ levels: ['P6'], sectionIds: null }, 'Specific levels'],
    // A whole half of levels stays "Specific levels" so an untouched save
    // round-trips exactly (never widened to "Secondary").
    [{ levels: ['S1', 'S2', 'S3', 'S4'], sectionIds: null }, 'Specific levels'],
    [{ levels: null, sectionIds: ['sec-1'] }, 'Specific classes'],
  ])('edit opens an event on the right option (%o → %s)', (scope, expected) => {
    stubFetch(() => Promise.resolve(jsonResponse({ sections: [] })));
    renderWithClient(
      <EventEditorDialog
        {...FUTURE_PROPS}
        editing={
          {
            id: 'evt-1',
            termId: 'term-1',
            startDate: '2099-12-31',
            endDate: '2099-12-31',
            label: 'Exam',
            category: 'term_exam',
            audience: 'all',
            tentative: false,
            ...scope,
          } as never
        }
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    expect(whoSelect()).toHaveTextContent(expected);
    if (expected === 'Specific levels') {
      for (const code of (scope as { levels: string[] }).levels) {
        expect(screen.getByRole('button', { name: code })).toHaveAttribute(
          'aria-pressed',
          'true'
        );
      }
    }
  });
});
