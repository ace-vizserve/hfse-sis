import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { FeedbackSheet } from '@/components/feedback-sheet';
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
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getDeclarationWaitingCount } from '@/lib/sidebar/notification-counts';
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
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  // `p_file_officer` was admitted to this route group for exactly ONE page —
  // the applicant file at /admissions/applications/[enroleeNumber], which their
  // own document-validation queue linked to (KD #173). That role was retired
  // 2026-09-10 and admissions absorbed the queue, so the carve-out (and the
  // P-Files chrome that went with it) is gone: everyone admitted here works in
  // Admissions.
  const allowed = [
    'admissions',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ] as const;
  if (!role || !(allowed as readonly string[]).includes(role)) {
    if (role === 'teacher') redirect('/markbook');
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  // One audience, one chrome. The P-Files officer used to be rendered the
  // P-Files sidebar here, because the applicant file was the only page in this
  // group they could reach; that role was retired 2026-09-10 and the branch
  // went with it.
  const sidebarModule: SidebarModule = 'admissions';

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
  const canReadPreEnrolmentDocs = can(
    capabilities,
    'documents_pre_enrolment.read'
  );
  const currentAy = await getCurrentAcademicYear();
  const badges: SidebarBadges =
    currentAy && canReadPreEnrolmentDocs
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

  // Always empty here, and cheaply so — the only tiles this hides are the ones
  // a subject-teacher-only account cannot use, and the redirect above already
  // turned every teacher away. Called anyway so all eight layouts read the
  // same and none has to carry that rule in its head. It also costs no query:
  // `resolveHiddenModules` returns early for a non-teacher role. See
  // lib/sidebar/module-visibility.ts.
  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module={sidebarModule}
        role={role}
        email={email}
        userId={id}
        badges={badges}
        hiddenModules={hiddenModules}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        roles={roles}
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <div className="flex items-center w-full mx-auto max-w-[1440px]">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-2">
              <FeedbackSheet />
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
