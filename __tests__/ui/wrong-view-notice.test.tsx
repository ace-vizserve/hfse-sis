/**
 * The "not one of your classes" notice, and the button that undoes it.
 *
 * This screen replaced a `notFound()` at four gates, and the review that
 * required it was blunt about why: only Markbook's nav is lensed, so in the
 * Teacher view a teaching admin's Attendance sidebar is still the admin's,
 * `/attendance/sections` lists every section in the school, and every row
 * linked into a 404. The bug was reachable by CLICKING, not by typing a URL.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IN THIS FILE IS THE ONE ABOUT A REAL TEACHER.
 * They must still get a plain 404 — `showWrongViewNotice` returning false is
 * what the four gates rely on to fall through to `notFound()`. A teacher has
 * one entitled view, nothing to switch to, and telling them "you're viewing as
 * Teacher" would be nonsense.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  showWrongViewNotice,
  WrongViewNotice,
} from '@/components/auth/wrong-view-notice';
import type { ViewContext } from '@/lib/auth/view-context';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  usePathname: () => '/attendance/sec-1',
  useSearchParams: () => new URLSearchParams('term_id=t2'),
}));

const apiFetchMock = vi.fn();
vi.mock('@/lib/query/fetcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/fetcher')>(
    '@/lib/query/fetcher'
  );
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

// The house idiom (see __tests__/_utils/mock-toast.ts): a complete facade so a
// method nobody asserts on cannot blow up, with hoisted spies for the two that
// are actually checked.
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));

/** The six live accounts this whole feature is for. */
const TEACHING_ADMIN: ViewContext = {
  id: 'u-1',
  email: 'admin@hfse.test',
  role: 'school_admin',
  entitled: ['school_admin', 'teacher'],
  activeRole: 'teacher',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('showWrongViewNotice — who is offered a way out', () => {
  it('a teaching admin looking through the Teacher lens', () => {
    expect(showWrongViewNotice(TEACHING_ADMIN)).toBe(true);
  });

  it('⚠ NOT a real teacher — they get the plain 404', () => {
    expect(
      showWrongViewNotice({
        ...TEACHING_ADMIN,
        role: 'teacher',
        entitled: ['teacher'],
        activeRole: 'teacher',
      })
    ).toBe(false);
  });

  it('not an admin who is already in her own view', () => {
    // She holds two views but is looking through her account's own. A class
    // she cannot open in the Admin view is genuinely not there.
    expect(
      showWrongViewNotice({ ...TEACHING_ADMIN, activeRole: 'school_admin' })
    ).toBe(false);
  });

  it('not an admin who does not teach', () => {
    expect(
      showWrongViewNotice({
        ...TEACHING_ADMIN,
        entitled: ['school_admin'],
        activeRole: 'school_admin',
      })
    ).toBe(false);
  });

  it('not a parent, who has no staff view at all', () => {
    expect(
      showWrongViewNotice({
        ...TEACHING_ADMIN,
        role: null,
        entitled: [],
        activeRole: null,
      })
    ).toBe(false);
  });
});

describe('the notice itself', () => {
  function renderNotice(view: ViewContext = TEACHING_ADMIN) {
    return render(
      <WrongViewNotice
        view={view}
        heading="Not one of your classes."
        body="You're viewing as Teacher, and 3/A isn't a class you advise."
        backHref="/attendance/sections"
        backLabel="Back to sections"
      />
    );
  }

  it('says which view you are in and what you tried to open', () => {
    renderNotice();
    expect(screen.getByText('Not one of your classes.')).toBeInTheDocument();
    expect(
      screen.getByText(/3\/A isn't a class you advise/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Viewing as Teacher/)).toBeInTheDocument();
  });

  it('names the view it will switch you to, in the same words the popover uses', () => {
    renderNotice();
    expect(
      screen.getByRole('button', { name: 'Switch to School Admin view' })
    ).toBeInTheDocument();
  });

  it('offers a way back that does not require switching', () => {
    renderNotice();
    const back = screen.getByRole('link', { name: 'Back to sections' });
    expect(back).toHaveAttribute('href', '/attendance/sections');
  });

  it('renders nothing at all for someone with no other view', () => {
    // Belt-and-braces: the gates check `showWrongViewNotice` before rendering,
    // but a card reading "Switch to null view" would be a bug on screen.
    const { container } = renderNotice({
      ...TEACHING_ADMIN,
      role: 'teacher',
      entitled: ['teacher'],
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('switching back returns you to the page you were on', () => {
  it('sends the current path AND query, and navigates to what the server allows', async () => {
    // The query string is the reason the destination is read from the live URL
    // rather than rebuilt from route params — dropping `?term_id=t2` would
    // silently reset the viewer's chosen term.
    apiFetchMock.mockResolvedValue({
      activeRole: 'school_admin',
      next: '/attendance/sec-1?term_id=t2',
    });
    render(
      <WrongViewNotice
        view={TEACHING_ADMIN}
        heading="Not one of your classes."
        body="…"
        backHref="/attendance/sections"
        backLabel="Back to sections"
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to School Admin view' })
    );

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/account/active-role',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          role: 'school_admin',
          next: '/attendance/sec-1?term_id=t2',
        }),
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Now viewing as School Admin');
    expect(pushMock).toHaveBeenCalledWith('/attendance/sec-1?term_id=t2');
  });

  it('⚠ navigates to the SERVER answer, never to the destination it asked for', async () => {
    // If the route refuses the destination it substitutes `/`. Trusting our
    // own input here would put the open-redirect check back on the client,
    // where it proves nothing.
    apiFetchMock.mockResolvedValue({ activeRole: 'school_admin', next: '/' });
    render(
      <WrongViewNotice
        view={TEACHING_ADMIN}
        heading="Not one of your classes."
        body="…"
        backHref="/attendance/sections"
        backLabel="Back to sections"
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to School Admin view' })
    );

    expect(pushMock).toHaveBeenCalledWith('/');
    expect(pushMock).not.toHaveBeenCalledWith('/attendance/sec-1?term_id=t2');
  });

  it('a failed switch says so in plain words and stays put', async () => {
    const { ApiError } = await import('@/lib/query/fetcher');
    apiFetchMock.mockRejectedValue(
      new ApiError(400, { error: 'not_entitled' }, 'Bad Request')
    );
    render(
      <WrongViewNotice
        view={TEACHING_ADMIN}
        heading="Not one of your classes."
        body="…"
        backHref="/attendance/sections"
        backLabel="Back to sections"
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to School Admin view' })
    );

    expect(toastError).toHaveBeenCalledWith(
      'You no longer have a School Admin view.'
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
