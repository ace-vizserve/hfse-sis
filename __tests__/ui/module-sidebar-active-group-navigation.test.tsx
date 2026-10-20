import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ModuleSidebar } from '@/components/module-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

// Navigating INTO a closed sidebar group opens it — as a client-side
// navigation, which Next runs as a transition.
//
// Regression: the open-on-navigate step used to be a useEffect with a
// functional update (`prev.has(key) ? prev : new Set(prev).add(key)`). Under a
// transition React re-ran that updater from the older base state on later
// renders, built a new Set each time, and — with the Radix ScrollArea inside
// the sidebar re-setting its own state from an inline ref callback — looped to
// "Maximum update depth exceeded". In the app it crashed the grading sheet when
// opened from /markbook/audit-log or /markbook/change-requests.
//
// The loop itself needs the App Router's real navigation scheduling and did
// not reproduce here (the old code passes the first test in jsdom); it was
// reproduced and verified in the browser. These tests pin the behaviour of the
// replacement: the destination group opens, and the viewer can close it again
// (the old effect re-ran on every render and reopened it at once — the second
// test fails on the old code).

const nav = vi.hoisted(() => ({
  ctx: null as React.Context<string> | null,
}));

vi.mock('next/navigation', async () => {
  const R = await import('react');
  nav.ctx = R.createContext('/records/students');
  return {
    usePathname: () => R.useContext(nav.ctx!),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  };
});

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
      records: [
        { items: [{ href: '/records', label: 'Dashboard' }] },
        {
          label: 'Operations',
          items: [
            { href: '/records/students', label: 'Students' },
            { href: '/records/unsynced', label: 'Unsynced' },
          ],
        },
        {
          label: 'Admin',
          items: [
            { href: '/records/audit-log', label: 'Audit Log' },
            { href: '/records/level-mismatches', label: 'Levels' },
          ],
        },
      ],
    },
  };
});

let navigate: (path: string) => void = () => {};

function Harness({ start }: { start: string }) {
  const [path, setPath] = React.useState(start);
  React.useEffect(() => {
    navigate = setPath;
  }, []);
  const Path = nav.ctx!;
  return (
    <Path.Provider value={path}>
      <SidebarProvider>
        <ModuleSidebar
          module="records"
          role="superadmin"
          email="test@hfse.test"
          userId="user-1"
          roles={['superadmin']}
        />
      </SidebarProvider>
    </Path.Provider>
  );
}

const trigger = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name) });

describe('sidebar group of the page navigated to', () => {
  it('opens the closed group a transition navigation lands in, without an update loop', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness start="/records/students" />);
    expect(trigger('Admin').getAttribute('data-state')).toBe('closed');

    await act(async () => {
      React.startTransition(() => navigate('/records/audit-log'));
    });
    // A plain re-render after the navigation must also settle.
    await act(async () => {
      navigate('/records/audit-log');
    });

    expect(trigger('Admin').getAttribute('data-state')).toBe('open');
    expect(
      errors.mock.calls.some((c) => /Maximum update depth/.test(String(c[0])))
    ).toBe(false);
    errors.mockRestore();
  });

  it('lets the viewer close the group holding the current page', async () => {
    const user = userEvent.setup();
    render(<Harness start="/records/students" />);
    const operations = trigger('Operations');
    expect(operations.getAttribute('data-state')).toBe('open');
    await user.click(operations);
    expect(operations.getAttribute('data-state')).toBe('closed');
  });
});
