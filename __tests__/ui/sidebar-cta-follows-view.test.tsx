/**
 * The rendered proof of `__tests__/sidebar/nav-badge-follows-rows.test.ts`.
 *
 * That file asserts `resolveNavView` hands one `rowsRole` to all three
 * consumers. This one mounts the real `ModuleSidebar` and checks the two things
 * a teaching admin would actually have SEEN: the approver's full-width "Review
 * change requests" button standing above a teacher's two-row Markbook menu, and
 * the badge scope handed to the realtime hook.
 *
 * Mock set copied from `module-sidebar-group-label.test.tsx` — the same chrome
 * (header popover, ⌘K trigger, profile footer) pulls in contexts and a supabase
 * client that jsdom has no business starting.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModuleSidebar } from '@/components/module-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { Role, SidebarBadges } from '@/lib/auth/roles';

vi.mock('next/navigation', () => ({
  usePathname: () => '/markbook',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Passthrough, but it RECORDS its fourth argument — that argument is the whole
// badge half of this fix, and a passthrough that ignored it would let the
// wiring rot while every visible assertion below stayed green.
const badgeScopeCalls: Array<Role | null | undefined> = [];
vi.mock('@/lib/sidebar/use-realtime-badges', () => ({
  useRealtimeBadges: (
    _role: Role | null,
    _userId: string,
    initial: SidebarBadges,
    rowsRole?: Role | null
  ) => {
    badgeScopeCalls.push(rowsRole);
    return initial;
  },
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

function renderMarkbookSidebar(activeRole: Role) {
  return render(
    <SidebarProvider>
      <ModuleSidebar
        module="markbook"
        role="school_admin"
        email="head@hfse.test"
        userId="user-1"
        badges={{ changeRequests: 4 }}
        entitled={['school_admin', 'teacher']}
        activeRole={activeRole}
      />
    </SidebarProvider>
  );
}

beforeEach(() => {
  badgeScopeCalls.length = 0;
});

describe('a teaching admin’s Markbook rail in the Teacher view', () => {
  it('does not carry the approver’s "Review change requests" button', () => {
    renderMarkbookSidebar('teacher');
    expect(screen.queryByText('Review change requests')).toBeNull();
  });

  it('shows the teacher menu it belongs to instead', () => {
    renderMarkbookSidebar('teacher');
    // Asserted on the UNGROUPED first section, which is the part of the rail
    // that is always in the DOM — every labelled group starts collapsed on a
    // first visit (`resolveExpandedGroups`), so "My Sheets" and "My Requests"
    // are behind a closed "Grading" expander and querying for them would test
    // the collapse behaviour rather than the lens.
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeTruthy();
    // `Insights` sits in that same ungrouped section for an oversight role and
    // is absent from the teacher tree — so it is the honest discriminator here.
    expect(screen.queryByRole('link', { name: /Insights/ })).toBeNull();
  });

  it('and scopes the change-request badge to the rows on screen', () => {
    renderMarkbookSidebar('teacher');
    expect(badgeScopeCalls[0]).toBe('teacher');
  });
});

describe('and in her own view nothing has changed', () => {
  it('the approver CTA is back, and so are her own rows', () => {
    renderMarkbookSidebar('school_admin');
    expect(
      screen.getAllByText('Review change requests').length
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Insights/ })).toBeTruthy();
  });

  it('with the badge scoped to her account again', () => {
    renderMarkbookSidebar('school_admin');
    expect(badgeScopeCalls[0]).toBe('school_admin');
  });
});
