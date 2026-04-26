import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ModuleSidebar } from '@/components/module-sidebar';
import { TestModeBanner } from '@/components/sis/test-mode-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function MarkbookLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  if (!role) redirect('/parent');
  if (role === 'p-file') redirect('/p-files');

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  const service = createServiceClient();
  const sidebarBadges: SidebarBadges = {
    changeRequests: await getSidebarChangeRequestCount(service, role, id),
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar module="markbook" role={role} email={email} userId={id} badges={sidebarBadges} />
      <SidebarInset>
        <TestModeBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10 print:bg-background print:p-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
