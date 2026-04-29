import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getParentSession } from '@/lib/parent/get-parent-session';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ParentSessionWatcher } from './parent-session-watcher';

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const session = await getParentSession();
  if (!session) {
    // No valid parent_session cookie. Three cases:
    //   (a) A staff user with a real role navigated here without
    //       handing off — bounce to the staff dashboard so they don't
    //       get sent out to the external parent portal.
    //   (b) Someone has a stale null-role Supabase session (e.g. left
    //       over from the pre-cookie parent flow that called
    //       setSession). Force re-login so their JWT refreshes.
    //   (c) Truly anonymous visitor (no Supabase session at all) —
    //       send them to the parent portal where the SSO originates.
    const staff = await getSessionUser();
    if (staff) {
      if (staff.role !== null) redirect('/');
      redirect('/login');
    }
    const portalUrl =
      process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
      'https://enrol.hfse.edu.sg/admission/dashboard';
    redirect(portalUrl);
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar module="parent" role={null} email={session.email} userId="" />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <div className="text-sm font-medium text-muted-foreground">HFSE Parent Portal</div>
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10 print:bg-background print:p-0">
          <ParentSessionWatcher />
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
