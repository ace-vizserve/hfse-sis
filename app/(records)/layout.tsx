import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getViewContext } from '@/lib/auth/view-context';
import { ModuleSidebar } from '@/components/module-sidebar';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getDeclarationWaitingCount } from '@/lib/sidebar/notification-counts';
import { countUnmatchedLevelLabels } from '@/lib/sis/level-review';
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
  const view = await getViewContext();
  if (!view) redirect('/login');

  const { id, email, role, entitled, activeRole } = view;
  if (
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
    unmatchedNameCount,
    awaitingSectionsCount,
    changeRequestCount,
    declarationCount,
  ] = await Promise.all([
    // Current AND upcoming AY — admissions enrol into next year's intake
    // during the early-bird window, and a badge that only counts the live
    // year hides that work until the year rolls over.
    countUnsyncedInScope(),
    countUnmatchedLevelLabels(),
    countLevelsAwaitingSections(),
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
  ]);
  // Both halves of "Levels needing attention" — an unrecognized level name and
  // a level with students waiting but no class. The page shows them as two
  // lists; the badge is the total, so it matches what the registrar finds
  // there.
  const levelAttentionCount = unmatchedNameCount + awaitingSectionsCount;
  const badges: SidebarBadges = {
    unsyncedStudents: unsyncedCount > 0 ? unsyncedCount : undefined,
    levelMismatches: levelAttentionCount > 0 ? levelAttentionCount : undefined,
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="records"
        role={role}
        email={email}
        userId={id}
        badges={badges}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        entitled={entitled}
        activeRole={activeRole}
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
