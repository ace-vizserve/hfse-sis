import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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
import { countPendingDocValidation } from '@/lib/admissions/document-validation';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getDeclarationWaitingCount } from '@/lib/sidebar/notification-counts';
import { resolvePFileBadges } from '@/lib/p-files/sidebar-badges';
import type { SidebarModule } from '@/lib/sidebar/registry';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function AdmissionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  // `p_file_officer` is admitted to this route group for exactly ONE page —
  // the applicant file at /admissions/applications/[enroleeNumber], which their
  // own document-validation queue links to (KD #173). ROUTE_ACCESS still blocks
  // them from every other route under /admissions; this list only decides
  // whether the layout renders at all, and a layout that redirected them would
  // make the permitted page unreachable.
  const allowed = [
    'admissions',
    'academic_coordinator',
    'school_admin',
    'superadmin',
    'p_file_officer',
  ] as const;
  if (!role || !(allowed as readonly string[]).includes(role)) {
    if (role === 'teacher') redirect('/markbook');
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  // THE OFFICER GETS P-FILES CHROME, NOT ADMISSIONS CHROME.
  //
  // They can reach exactly one page in this route group, so the Admissions
  // sidebar would offer them ~10 nav rows — dashboard, insights, the pipeline,
  // the cohorts, the archive — every one of which the proxy blocks. The module
  // switcher would also claim they are "in Admissions", which they are not.
  //
  // Rendering the P-Files sidebar keeps the applicant file feeling like a
  // record they opened from their own queue: the nav still points home, and
  // Back returns them to the module they actually work in.
  const isPFileOfficer = role === 'p_file_officer';
  const sidebarModule: SidebarModule = isPFileOfficer
    ? 'p-files'
    : 'admissions';

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    sidebarModule
  );

  // Sidebar badges — currently only the doc-validation pending count.
  // SSR-static (no realtime subscription): the docs columns live in the
  // admissions Supabase project and the realtime hook only subscribes to
  // the main project, so the badge refreshes on the next navigation.
  // `loadPendingDocValidation` (the source for the count) is `unstable_cache`d
  // with tag `sis:${ayCode}` and auto-invalidates on the validate PATCH.
  //
  // Only the holders of this capability see the Document validation row at all
  // (its nav item is capability-gated, KD #173), so counting for anyone else is
  // a wasted three-table query every page load.
  //
  // The officer is the exception: their sidebar is the P-Files one, whose
  // badge key is different, so it has to be resolved by the P-Files helper.
  // Passing the admissions badge to a P-Files sidebar would set a key no
  // P-Files nav item reads — a count computed and then silently dropped.
  const canReadPreEnrolmentDocs = can(
    capabilities,
    'documents_pre_enrolment.read'
  );
  const currentAy = await getCurrentAcademicYear();
  const badges: SidebarBadges = !currentAy
    ? {}
    : isPFileOfficer
      ? await resolvePFileBadges(currentAy.ay_code, capabilities)
      : canReadPreEnrolmentDocs
        ? {
            pendingDocValidation: await countPendingDocValidation(
              currentAy.ay_code
            ),
          }
        : {};

  const service = createServiceClient();
  const changeRequestCount =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin'
      ? await getSidebarChangeRequestCount(service, role, id)
      : null;

  // ⚠ Not gated on role, unlike the count above. Whether somebody approves a
  // declaration is decided by whether they are ON a step — a form class adviser
  // holds a plain `teacher` account and the officer in charge does too — so the
  // count answers that itself and returns 0 for everybody else.
  const declarationCount = await getDeclarationWaitingCount(service, role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module={sidebarModule}
        role={role}
        email={email}
        userId={id}
        badges={badges}
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
                initialDeclarationCount={declarationCount}
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
