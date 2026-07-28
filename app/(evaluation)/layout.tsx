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
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';

export default async function EvaluationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
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

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  const service = createServiceClient();
  const changeRequestCount = await getSidebarChangeRequestCount(
    service,
    role,
    id
  );

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="evaluation"
        role={role}
        email={email}
        userId={id}
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
