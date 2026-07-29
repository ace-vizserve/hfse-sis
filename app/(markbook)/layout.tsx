import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ModuleSidebar } from '@/components/module-sidebar';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function MarkbookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  const service = createServiceClient();
  const sidebarBadges: SidebarBadges = {
    changeRequests: await getSidebarChangeRequestCount(service, role, id),
  };

  // Hide switcher tiles this teacher can never use (subject-teacher-only
  // users have no Attendance or Evaluation work). No-op for every other role.
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
                initialCount={sidebarBadges.changeRequests ?? null}
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
