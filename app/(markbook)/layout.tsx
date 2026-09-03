import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { resolveNavView } from '@/lib/auth/nav-visibility';
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
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks. Kept on the MODULE layout, not
// the root, so the rest of the app keeps validating; pages below can opt back in.
export const instant = false;

export default async function MarkbookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'markbook'
  );

  const service = createServiceClient();
  const [changeRequestCount, declarationCount] = await Promise.all([
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
  ]);

  // ⚠ ONE COUNT, AND IT MUST STAY KEYED ON THE ROLE THE SIDEBAR IS RENDERING.
  //
  // The badge hangs off whichever row the tree puts there, and the two
  // candidate rows point at different pages with different scopes:
  //   • oversight tree → "Change Requests" → /markbook/change-requests, the
  //     approval inbox: pending requests awaiting THIS approver.
  //   • teacher tree → "My Requests" → /markbook/grading/requests, which
  //     filters `requested_by = userId` for EVERY role (it says so in its own
  //     comment) and heads the page with a "Pending" stat card.
  // `getSidebarChangeRequestCount(service, role, id)` answers for whichever of
  // those two the viewer's role draws, so the badge and its destination agree.
  // A teaching admin who switches to Teacher gets the teacher tree AND the
  // teacher's number, because the switch changes `role` itself.
  //
  // ⚠ `declarations` is NOT put on the badges here. The Declarations nav item
  // lives in the Attendance sidebar, not this one — Markbook has no row for it
  // to hang off. The count still reaches the header bell below, which is the
  // point: an absence waiting for you should tap you on the shoulder wherever
  // you are in the app.
  const sidebarBadges: SidebarBadges = {
    changeRequests: changeRequestCount,
  };

  // Tiles that would be dead ends for this person: a subject-teacher-only user
  // has no Attendance or Evaluation work of their own, so those two go. The
  // module you are IN is never hidden, so this can never strand anyone
  // (components/module-sidebar/sidebar-header.tsx). See
  // lib/sidebar/module-visibility.ts.
  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="markbook"
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
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
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
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10 print:bg-background print:p-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
