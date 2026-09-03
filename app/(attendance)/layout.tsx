import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getDeclarationWaitingCount } from '@/lib/sidebar/notification-counts';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { createServiceClient } from '@/lib/supabase/service';
import type { SidebarBadges } from '@/lib/auth/roles';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  const allowed: Array<typeof role> = [
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ];
  if (!role || !allowed.includes(role)) {
    if (role === 'p_file_officer') redirect('/p-files');
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'attendance'
  );

  const service = createServiceClient();
  const [changeRequestCount, declarationCount] = await Promise.all([
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
  ]);

  // The Declarations nav item carries the same number the bell adds in — how
  // many are waiting for this person, not how many exist.
  const sidebarBadges: SidebarBadges = { declarations: declarationCount };

  // Tiles that would be dead ends for this person: a subject-teacher-only user
  // has no Attendance or Evaluation work of their own, so those two go. The
  // module you are IN is never hidden, so this can never strand anyone
  // (components/module-sidebar/sidebar-header.tsx). See
  // lib/sidebar/module-visibility.ts.
  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="attendance"
        role={role}
        email={email}
        userId={id}
        hiddenModules={hiddenModules}
        badges={sidebarBadges}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        roles={roles}
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
