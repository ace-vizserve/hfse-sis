import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getViewContext } from '@/lib/auth/view-context';
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

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function EvaluationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getViewContext();
  if (!view) redirect('/login');

  const { id, email, role, entitled, activeRole } = view;
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
    'evaluation'
  );

  const service = createServiceClient();
  const [changeRequestCount, declarationCount] = await Promise.all([
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
  ]);

  // Two narrowings, one list. ASSIGNMENTS: a subject-teacher-only user has no
  // Attendance or Evaluation work, so those tiles are dead ends for them — that
  // half reads the real `role` and always will. THE VIEW: `/sis`, `/records`,
  // `/p-files` and `/admissions` do not admit a teacher, so a teaching admin in
  // the Teacher view is not offered a tile whose sidebar that view cannot fill.
  // No-op for every account with a single view. See
  // lib/sidebar/module-visibility.ts.
  const hiddenModules = await resolveHiddenModules(role, id, activeRole);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="evaluation"
        role={role}
        email={email}
        userId={id}
        hiddenModules={hiddenModules}
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
