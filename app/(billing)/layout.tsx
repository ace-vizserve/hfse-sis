import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SIDEBAR_GROUPS_COOKIE,
  expandedGroupsFor,
} from '@/lib/sidebar/group-state';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { FeedbackSheet } from '@/components/feedback-sheet';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import {
  getDeclarationWaitingCount,
  getSowWaitingCount,
  getStagedWaitingCount,
} from '@/lib/sidebar/notification-counts';
import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

// Cache Components (next.config.ts) requires each segment to prerender into a
// static shell or declare that it blocks. This layout reads cookies() to gate on
// the session (KD #35), so it legitimately blocks.
export const instant = false;

// Billing — the same three roles that invoice (lib/qbo/roles.ts). The
// `/billing` ROUTE_ACCESS row lets the same set through the proxy.
export default async function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');

  const { id, email, role, roles } = view;
  if (!role || !(QBO_INVOICE_ROLES as readonly string[]).includes(role)) {
    if (!role) redirect('/login');
    redirect('/');
  }

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';
  const expandedGroups = expandedGroupsFor(
    cookieStore.get(SIDEBAR_GROUPS_COOKIE)?.value,
    'billing'
  );

  const service = createServiceClient();
  const [
    changeRequestCount,
    declarationCount,
    gradeChangeStepCount,
    sowStepCount,
  ] = await Promise.all([
    getSidebarChangeRequestCount(service, role, id),
    getDeclarationWaitingCount(service, role, id),
    getStagedWaitingCount(service, role, id, GRADE_CHANGE_FLOWS),
    // Schemes of work at a step this person is on — the bell's fourth source.
    getSowWaitingCount(service, role, id),
  ]);

  const hiddenModules = await resolveHiddenModules(role, id);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="billing"
        role={role}
        email={email}
        userId={id}
        hiddenModules={hiddenModules}
        capabilities={capabilities}
        expandedGroups={expandedGroups}
        roles={roles}
      />
      {/* min-w-0: a wide table scrolls inside its own box instead of
          widening the whole page (Billing lists are wide). */}
      <SidebarInset className="min-w-0">
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
                initialSowStepCount={sowStepCount}
              />
            </div>
          </div>
        </header>
        <div className="flex-1 bg-muted px-4 py-6 md:px-6 md:py-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
