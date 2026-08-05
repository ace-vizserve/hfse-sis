import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { countUnmatchedLevelLabels } from '@/lib/sis/level-review';
import { countLevelsAwaitingSections } from '@/lib/sis/levels-awaiting-sections';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';
import { createServiceClient } from '@/lib/supabase/service';

export default async function RecordsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
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

  // Sidebar badges — SSR-static (no realtime subscription per KD #29).
  // `countUnsyncedEnrolledStudents` shares the `sis:${ayCode}` cache tag
  // with the loader, so the badge refreshes whenever an admissions
  // mutation runs (which is what AssignSectionDialog triggers anyway).
  const currentAy = await getCurrentAcademicYear();
  const service = createServiceClient();
  const [
    unsyncedCount,
    unmatchedNameCount,
    awaitingSectionsCount,
    changeRequestCount,
  ] = await Promise.all([
    currentAy ? countUnsyncedEnrolledStudents(currentAy.ay_code) : 0,
    countUnmatchedLevelLabels(),
    countLevelsAwaitingSections(),
    getSidebarChangeRequestCount(service, role, id),
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
