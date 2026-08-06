import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getStaffCount } from '@/lib/auth/staff-list';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { SidebarCounts } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSectionsCount } from '@/lib/sis/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';

export default async function SisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  // THE INVARIANT: a route-GROUP layout is the UNION of its group's
  // ROUTE_ACCESS rows, never the intersection. The layout runs before the page,
  // so it must admit every role allowed on ANY path in the group — otherwise it
  // shuts someone out of a route the route table explicitly grants them, and the
  // symptom is a redirect from a page that never got to run its own guard.
  //
  // Which is why `admissions` appears here while the broad `/sis` ROUTE_ACCESS
  // row excludes them: they are admitted by the longer-prefix
  // `/sis/admin/discount-codes` row (KD #133), the single cross-module surface
  // they own operationally. That is NOT a leak and must not be "tidied" into
  // matching the `/sis` row — doing so would break Discount Codes for the team
  // that uses it. The narrowing is the per-route gate's job, and it does it:
  // longest-prefix-wins keeps them on that one route, every other /sis nav entry
  // is hidden from them via `requiresRoles`, and the bare Admin Hub link is
  // gated, so they see no dead links.
  //
  // Same reasoning admits `academic_coordinator`, who holds rows for ay-setup,
  // calendar, sections, staff and admin/subjects plus the `/sis` hub itself
  // (KD #169), while audit-log, school-config, approvers and admin/roles carry
  // longer-prefix rows that keep her out.
  if (
    role !== 'admissions' &&
    role !== 'academic_coordinator' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    if (role === 'p_file_officer') redirect('/p-files');
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'sis'
  );

  const currentAy = await getCurrentAcademicYear();
  const readiness =
    (role === 'school_admin' || role === 'superadmin') && currentAy
      ? await getAyReadiness(currentAy.ay_code)
      : null;

  // Sidebar "This year" group count chips (SIS Admin visual pass, Task V2).
  // AY Setup reuses the `readiness` fetch above (same data already powers
  // the floating readiness pill) — no extra query. Sections/Staff are only
  // fetched for the roles that actually see those nav items (registrar +
  // school_admin + superadmin); admissions (single Discount Codes link)
  // and any other role skip the fetch entirely.
  const canSeeYearNav =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  const [sectionsCount, staffCount] =
    canSeeYearNav && currentAy
      ? await Promise.all([
          getSectionsCount(currentAy.ay_code),
          getStaffCount(),
        ])
      : [null, null];

  const service = createServiceClient();
  const changeRequestCount =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin'
      ? await getSidebarChangeRequestCount(service, role, id)
      : null;

  const sidebarCounts: SidebarCounts = {};
  if (readiness) {
    sidebarCounts.aySetupReadiness = `${readiness.complete}/${readiness.total}`;
  }
  if (sectionsCount != null) {
    sidebarCounts.sectionsCount = String(sectionsCount);
  }
  if (staffCount != null) {
    sidebarCounts.staffCount = String(staffCount);
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="sis"
        role={role}
        email={email}
        userId={id}
        counts={sidebarCounts}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <div className="flex items-center w-full mx-auto max-w-[1440px]">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto">
              <NotificationBell
                role={role}
                userId={id}
                initialCount={changeRequestCount}
              />
            </div>
          </div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
