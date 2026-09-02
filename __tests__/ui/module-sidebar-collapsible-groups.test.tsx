import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ModuleSidebar } from '@/components/module-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

// Collapsible sidebar groups.
//
// The load-bearing case is the roll-up badge. Every badge in the app sits
// inside a labelled group, so a group that closes without surfacing what it
// hides silently swallows the only signal that says something needs doing —
// a functional regression dressed as a UI change.

vi.mock('next/navigation', () => ({
  usePathname: () => '/records/students',
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
      records: [
        { items: [{ href: '/records', label: 'Dashboard' }] },
        {
          // Holds the current page, so it opens. Carries a hint to prove the
          // right-hand slot returns to the hint once open.
          label: 'Operations',
          hint: 'weekly',
          items: [
            { href: '/records/students', label: 'Students' },
            {
              href: '/records/unsynced',
              label: 'Unsynced',
              badgeKey: 'unsyncedStudents',
            },
          ],
        },
        {
          label: 'Cohorts',
          items: [{ href: '/records/cohorts', label: 'All cohorts' }],
        },
        {
          label: 'Admin',
          items: [
            { href: '/records/audit-log', label: 'Audit Log' },
            {
              href: '/records/level-mismatches',
              label: 'Levels',
              badgeKey: 'levelMismatches',
            },
          ],
        },
        {
          label: 'Reports',
          items: [
            { href: '/records/reports/a', label: 'Report A' },
            { href: '/records/reports/b', label: 'Report B' },
          ],
        },
      ],
    },
  };
});

function renderSidebar(expandedGroups?: string[]) {
  return render(
    <SidebarProvider>
      <ModuleSidebar
        module="records"
        role="superadmin"
        email="test@hfse.test"
        userId="user-1"
        badges={{ unsyncedStudents: 5, levelMismatches: 4 }}
        expandedGroups={expandedGroups}
        entitled={['superadmin']}
        activeRole="superadmin"
      />
    </SidebarProvider>
  );
}

function groupTrigger(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) });
}

describe('collapsible sidebar groups', () => {
  it('gives a multi-item group a toggle and leaves a single-item group a plain label', () => {
    renderSidebar();
    expect(groupTrigger('Operations')).toBeTruthy();
    expect(groupTrigger('Admin')).toBeTruthy();
    // Single item — a toggle would hide one row.
    expect(screen.queryByRole('button', { name: /Cohorts/ })).toBeNull();
    expect(screen.getByText('Cohorts')).toBeTruthy();
  });

  it('opens the group holding the current page and leaves the others closed', () => {
    renderSidebar();
    expect(groupTrigger('Operations').getAttribute('data-state')).toBe('open');
    expect(groupTrigger('Admin').getAttribute('data-state')).toBe('closed');
    // The open group's items are reachable; the closed group's are not.
    expect(screen.getByRole('link', { name: /Students/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Audit Log/ })).toBeNull();
  });

  it('surfaces the badges a closed group is hiding', () => {
    renderSidebar();
    expect(groupTrigger('Admin').textContent).toContain('4');
  });

  it('shows an item count on a closed group that hides no badges', () => {
    renderSidebar();
    expect(groupTrigger('Reports').textContent).toContain('2');
  });

  it('shows the cadence hint instead of a count once the group is open', () => {
    renderSidebar();
    const operations = groupTrigger('Operations');
    expect(operations.textContent).toContain('weekly');
    // The open group shows its items, so it must not also claim a count.
    expect(operations.textContent).not.toContain('2');
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const admin = groupTrigger('Admin');
    await user.click(admin);
    expect(admin.getAttribute('data-state')).toBe('open');
    expect(screen.getByRole('link', { name: /Audit Log/ })).toBeTruthy();
  });

  it('rails a labelled group’s rows, and leaves the unlabelled Dashboard group flush', () => {
    renderSidebar();
    const contentFor = (linkName: RegExp) =>
      screen
        .getByRole('link', { name: linkName })
        .closest('[data-sidebar="group-content"]')!;

    // Belongs to a heading -> railed.
    expect(contentFor(/Students/).className).toMatch(/border-l/);
    // No heading to belong to -> flush.
    expect(contentFor(/Dashboard/).className).not.toMatch(/border-l/);
  });

  it('restores saved groups, and still opens the active one', () => {
    renderSidebar(['admin']);
    expect(groupTrigger('Admin').getAttribute('data-state')).toBe('open');
    // Saved state omitted Operations, but it holds the current page — a viewer
    // who cannot see where they are has lost their place.
    expect(groupTrigger('Operations').getAttribute('data-state')).toBe('open');
    expect(groupTrigger('Reports').getAttribute('data-state')).toBe('closed');
  });
});
