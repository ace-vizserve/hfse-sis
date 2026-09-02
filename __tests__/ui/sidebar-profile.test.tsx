import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 2 of the role switcher (see .superpowers/sdd/role-switcher/): the
// "Switch view" section inside the profile popover that already hosts
// Account / Sign out. Renders only when the viewer holds more than one
// entitled role (six accounts today); everyone else's popover is unchanged.

const { pushMock, refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: refreshMock,
  }),
}));

const fetchMock = vi.fn(async (..._args: unknown[]) => ({
  activeRole: 'teacher',
}));
vi.mock('@/lib/query/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/fetcher')>();
  return { ...actual, apiFetch: (...args: unknown[]) => fetchMock(...args) };
});

// Full facade mock (`__tests__/_utils/mock-toast.ts`) — the component only
// calls `success` / `error`, but `sonner` is a 10-method path alias onto the
// sileo facade, and a 2-method mock breaks the moment anything else is added.
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue(undefined) },
  }),
}));

import { SidebarProfile } from '@/components/module-sidebar/sidebar-profile';
import { ApiError } from '@/lib/query/fetcher';

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  fetchMock.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

async function openPopover() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /admin@hfse\.test/i }));
  return user;
}

describe('SidebarProfile — switch view section', () => {
  it('is absent with a single entitled role, and the rest of the popover renders as before', async () => {
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin']}
        activeRole="school_admin"
      />
    );
    await openPopover();

    expect(screen.queryByText('Switch view')).not.toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('is present with two entitled roles, and marks the active one', async () => {
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="school_admin"
      />
    );
    await openPopover();

    expect(screen.getByText('Switch view')).toBeInTheDocument();
    const activeRow = screen.getByRole('button', { name: 'School Admin' });
    const otherRow = screen.getByRole('button', { name: 'Teacher' });
    expect(activeRow).toHaveAttribute('aria-current', 'true');
    expect(otherRow).not.toHaveAttribute('aria-current');
  });

  it('shows the caption for the ACTIVE view in both the trigger and the popover header', async () => {
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="teacher"
      />
    );
    // The trigger's own caption, before opening anything. Uppercase is a CSS
    // treatment (`uppercase`), not the rendered text content.
    expect(screen.getByText('Teacher')).toBeInTheDocument();

    await openPopover();

    // The header inside the popover repeats it — the brief's "both the trigger
    // and the popover header" requirement. Two instances: trigger + header.
    // (A third, unrelated "Teacher" also appears once the switch-view row list
    // renders, so this counts at least two rather than exactly two.)
    const matches = screen.getAllByText('Teacher');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('clicking the inactive row posts the role, confirms with a toast, and navigates to /', async () => {
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="school_admin"
      />
    );
    const user = await openPopover();

    await user.click(screen.getByRole('button', { name: 'Teacher' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/account/active-role');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ role: 'teacher' });

    // `/` has no sidebar of its own, so the toast is what confirms the switch
    // landed — raised before the navigation, not after.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Now viewing as Teacher')
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('clicking the active row does nothing', async () => {
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="school_admin"
      />
    );
    const user = await openPopover();

    await user.click(screen.getByRole('button', { name: 'School Admin' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a plain-English message when entitlement was lost, never the route’s raw code', async () => {
    // Entitlement is recomputed per request — the popover was rendered while
    // the account still held the teacher view, but the request itself is
    // refused. The route's `not_entitled` string must never reach the screen.
    fetchMock.mockRejectedValueOnce(
      new ApiError(400, { error: 'not_entitled' }, 'not_entitled')
    );
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="school_admin"
      />
    );
    const user = await openPopover();

    await user.click(screen.getByRole('button', { name: 'Teacher' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'You no longer have a Teacher view.'
      )
    );
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining('not_entitled')
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('translates an expired session rather than showing "unauthenticated"', async () => {
    fetchMock.mockRejectedValueOnce(
      new ApiError(401, { error: 'unauthenticated' }, 'unauthenticated')
    );
    render(
      <SidebarProfile
        email="admin@hfse.test"
        entitled={['school_admin', 'teacher']}
        activeRole="school_admin"
      />
    );
    const user = await openPopover();

    await user.click(screen.getByRole('button', { name: 'Teacher' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Your session has expired. Sign in again.'
      )
    );
  });
});
