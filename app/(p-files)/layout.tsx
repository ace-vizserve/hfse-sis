import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { countAwaitingVerification } from '@/lib/p-files/document-validation';
import { createServiceClient } from '@/lib/supabase/service';
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

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  const currentAy = await getCurrentAcademicYear();
  const badges: SidebarBadges = currentAy
    ? {
        pfileAwaitingVerification: await countAwaitingVerification(
          currentAy.ay_code
        ),
      }
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
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto">
            <NotificationBell
              role={role}
              userId={id}
              initialCount={changeRequestCount}
            />
          </div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
