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
import { getViewContext } from '@/lib/auth/view-context';
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
  const view = await getViewContext();
  if (!view) redirect('/login');

  const { id, email, role, entitled, activeRole } = view;
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'markbook'
  );

  // Which role's ROWS the sidebar below will render. Pure, no query — and it is
  // the same function the sidebar itself calls, so the badge cannot end up
  // describing a different page from the row it hangs off.
  const { rowsRole } = resolveNavView(
    'markbook',
    role,
    capabilities,
    activeRole
  );

  const service = createServiceClient();
  const [changeRequestsForRole, changeRequestsForRows, declarationCount] =
    await Promise.all([
      // THE BELL'S number — always the account's. See the ⚠ below.
      getSidebarChangeRequestCount(service, role, id),
      // THE SIDEBAR BADGE'S number, and a second query ONLY for the six
      // teaching admins while they are in the Teacher view. Everyone else has
      // `rowsRole === role` and pays nothing.
      rowsRole != null && rowsRole !== role
        ? getSidebarChangeRequestCount(service, rowsRole, id)
        : Promise.resolve(null),
      getDeclarationWaitingCount(service, role, id),
    ]);

  // ⚠ TWO COUNTS, AND THEY ARE NOT REDUNDANT.
  //
  // The badge hangs off whichever row the LENS chose, and the two candidate
  // rows point at different pages with different scopes:
  //   • oversight tree → "Change Requests" → /markbook/change-requests, the
  //     approval inbox: pending requests awaiting THIS approver.
  //   • teacher tree → "My Requests" → /markbook/grading/requests, which
  //     filters `requested_by = userId` for EVERY role (it says so in its own
  //     comment) and heads the page with a "Pending" stat card.
  // `getSidebarChangeRequestCount(service, 'teacher', id)` is exactly that stat
  // card's query — same AY scope, same filter — so the badge and its
  // destination now agree. Keyed on `role` it read the approval queue: a number
  // beside "My Requests" counting other people's work.
  //
  // The BELL stays on the account role, and that is not an oversight. It is a
  // global "somebody needs you" indicator, its dropdown is served by
  // `/api/change-requests/preview`, and that route resolves scope from the real
  // role — as it must, because `__tests__/auth/view-role-call-sites.test.ts`
  // forbids an API route from naming the lens at all. Lensing the bell here
  // would make its number disagree with its own list.
  //
  // ⚠ `declarations` is NOT put on the badges here. The Declarations nav item
  // lives in the Attendance sidebar, not this one — Markbook has no row for it
  // to hang off. The count still reaches the header bell below, which is the
  // point: an absence waiting for you should tap you on the shoulder wherever
  // you are in the app.
  const sidebarBadges: SidebarBadges = {
    changeRequests: changeRequestsForRows ?? changeRequestsForRole,
  };

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
        module="markbook"
        role={role}
        email={email}
        userId={id}
        hiddenModules={hiddenModules}
        badges={sidebarBadges}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        entitled={entitled}
        activeRole={activeRole}
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
                initialCount={changeRequestsForRole}
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
