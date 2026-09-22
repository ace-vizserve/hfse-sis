import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import { FeedbackSheet } from '@/components/feedback-sheet';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import {
  getDeclarationWaitingCount,
  getStagedWaitingCount,
} from '@/lib/sidebar/notification-counts';
import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import { countBlockingLevelLabels } from '@/lib/sis/level-review';
import { countLevelsAwaitingSections } from '@/lib/sis/levels-awaiting-sections';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { countUnsyncedInScope } from '@/lib/sis/unsynced-students';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function RecordsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  if (
    role !== 'admissions' &&
    role !== 'academic_coordinator' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'records'
  );

  // Sidebar badges — SSR-static (no realtime subscription per KD #29).
  // Each count shares the `sis:${ayCode}` cache tag with its loader, so the
  // badges refresh whenever an admissions mutation runs (which is what
  // AssignSectionDialog triggers anyway). All three resolve their own AY
  // scope — current plus the upcoming accepting year — so they agree with
  // the pages they link to.
  const service = createServiceClient();
  const [
    unsyncedCount,
    blockingNameCount,
    awaitingSectionsCount,
    changeRequestCount,
    declarationCount,
    gradeChangeStepCount,
  ] = await Promise.all([
    // Current AND upcoming AY — admissions enrol into next year's intake
    // during the early-bird window, and a badge that only counts the live
    // year hides that work until the year rolls over.
    countUnsyncedInScope(),
    countBlockingLevelLabels(),
    countLevelsAwaitingSections(),
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
    // Grade changes decided step by step — the bell's third source.
    getStagedWaitingCount(service, role, id, GRADE_CHANGE_FLOWS),
  ]);
  // Both halves of "Levels needing attention" — an unrecognized level name and
  // a level with students waiting but no class.
  //
  // ⚠ BOTH HALVES COUNT PEOPLE WAITING, NOT ROWS. The name half used to be
  // every unresolved label, which badged housekeeping as work: today all 11
  // unmapped names sit in front of applicants who are not enrolled yet, so
  // the badge claimed 11 jobs that clearing would not move anyone through.
  // `countBlockingLevelLabels` is the demand-driven count the sections half
  // has always used; the quieter names are still on the page, under their own
  // tab.
  const levelAttentionCount = blockingNameCount + awaitingSectionsCount;
  const badges: SidebarBadges = {
    unsyncedStudents: unsyncedCount > 0 ? unsyncedCount : undefined,
    levelMismatches: levelAttentionCount > 0 ? levelAttentionCount : undefined,
  };

  // Always empty here, and cheaply so — the only tiles this hides are the ones
  // a subject-teacher-only account cannot use, and `/records` does not admit a
  // teacher at all. Called anyway so all eight layouts read the same and none
  // has to carry that rule in its head. It also costs no query:
  // `resolveHiddenModules` returns early for a non-teacher role. See
  // lib/sidebar/module-visibility.ts.
  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="records"
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
                initialGradeChangeStepCount={gradeChangeStepCount}
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
