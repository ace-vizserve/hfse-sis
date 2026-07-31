import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { resolvePFileBadges } from '@/lib/p-files/sidebar-badges';
import { createServiceClient } from '@/lib/supabase/service';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { SidebarBadges } from '@/lib/auth/roles';
import { ModuleSidebar } from '@/components/module-sidebar';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

export default async function PFilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  if (
    role !== 'p_file_officer' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  )
    redirect('/');

  const capabilities = await getCapabilitiesForRole(role);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  // Badge counts BOTH document-validation queues the viewer can actually see —
  // enrolled students and, since migration 106 gave the officer the
  // pre-enrolment capabilities, applicants too (KD #173).
  const currentAy = await getCurrentAcademicYear();
  const badges: SidebarBadges = currentAy
    ? await resolvePFileBadges(currentAy.ay_code, capabilities)
    : {};

  const service = createServiceClient();
  const changeRequestCount =
    role === 'school_admin' || role === 'superadmin'
      ? await getSidebarChangeRequestCount(service, role, id)
      : null;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="p-files"
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
