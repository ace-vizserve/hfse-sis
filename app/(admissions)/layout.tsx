import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { AdmissionsSidebar } from '@/components/admissions-sidebar';
import { ModuleSwitcher } from '@/components/module-switcher';
import { TestModeBanner } from '@/components/sis/test-mode-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { getSessionUser } from '@/lib/supabase/server';

export default async function AdmissionsLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { email, role } = sessionUser;
  const allowed = ['admissions', 'registrar', 'school_admin', 'admin', 'superadmin'] as const;
  if (!role || !(allowed as readonly string[]).includes(role)) {
    if (role === 'p-file') redirect('/p-files');
    if (role === 'teacher') redirect('/markbook');
    if (!role) redirect('/parent');
    redirect('/');
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AdmissionsSidebar email={email} role={role} />
      <SidebarInset>
        <TestModeBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <ModuleSwitcher currentModule="admissions" role={role} />
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
