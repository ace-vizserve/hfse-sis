import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleSidebar } from '@/components/module-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

// Nested child rows — the sidebar half of promoting in-page tabs to routes.
//
// The parent stays a link because it is a real route of its own; only the
// chevron toggles. Making the row itself the trigger would cost a click to
// reach a page that already exists.

const h = vi.hoisted(() => ({ pathname: '/sis' }));

vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/sidebar/use-realtime-badges', () => ({
  useRealtimeBadges: (
    _role: unknown,
    _userId: unknown,
    initial: Record<string, number>
  ) => initial,
}));

vi.mock('@/components/sis/command-palette', () => ({
  CommandPaletteTrigger: () => null,
}));
vi.mock('@/components/module-sidebar/sidebar-header', () => ({
  ModuleSidebarHeader: () => null,
}));
vi.mock('@/components/module-sidebar/sidebar-profile', () => ({
  SidebarProfile: () => null,
}));

vi.mock('@/lib/auth/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/roles')>();
  return {
    ...actual,
    NAV_BY_MODULE: {
      ...actual.NAV_BY_MODULE,
      sis: [
        { items: [{ href: '/sis', label: 'Admin Hub' }] },
        {
          label: 'Organisation',
          items: [
            {
              href: '/sis/admin/staff',
              label: 'Staff',
              children: [
                { href: '/sis/admin/staff', label: 'Teacher assignments' },
                { href: '/sis/admin/staff/accounts', label: 'Accounts' },
              ],
            },
            { href: '/sis/admin/subjects', label: 'Subjects' },
          ],
        },
      ] satisfies import('@/lib/auth/roles').NavSection[],
    },
  };
});

function renderSidebar() {
  return render(
    <SidebarProvider>
      <ModuleSidebar
        module="sis"
        role="superadmin"
        email="test@hfse.test"
        userId="user-1"
        expandedGroups={['organisation']}
        entitled={['superadmin']}
        activeRole="superadmin"
      />
    </SidebarProvider>
  );
}

beforeEach(() => {
  h.pathname = '/sis';
});

describe('nested child nav rows', () => {
  it('gives a parent with children an expander, and one without none', () => {
    renderSidebar();
    expect(
      screen.getByRole('button', { name: /Show Staff pages/ })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Subjects pages/ })).toBeNull();
  });

  it('keeps the parent row a link rather than turning it into a toggle', () => {
    renderSidebar();
    expect(
      screen.getByRole('link', { name: /Staff/ }).getAttribute('href')
    ).toBe('/sis/admin/staff');
  });

  it('hides children until the parent is expanded', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Accounts' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Show Staff pages/ }));
    expect(screen.getByRole('link', { name: 'Accounts' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Accounts' }).getAttribute('href')
    ).toBe('/sis/admin/staff/accounts');
  });

  it('opens the parent and marks the child when standing on a child route', () => {
    h.pathname = '/sis/admin/staff/accounts';
    renderSidebar();

    const child = screen.getByRole('link', { name: 'Accounts' });
    expect(child).toBeTruthy();
    expect(
      child
        .closest('[data-sidebar="menu-sub-button"]')
        ?.getAttribute('data-active')
    ).toBe('true');
  });

  it('does not mark the parent active when a child is the current page', () => {
    h.pathname = '/sis/admin/staff/accounts';
    renderSidebar();

    // Longest-href-wins: the child matched, so the parent must not also claim
    // to be where you are.
    const parent = screen.getByRole('link', { name: /Staff/ });
    expect(
      parent
        .closest('[data-sidebar="menu-button"]')
        ?.getAttribute('data-active')
    ).not.toBe('true');
  });
});
