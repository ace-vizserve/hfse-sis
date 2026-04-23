import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSwitcher } from '@/components/module-switcher';
import { EvaluationSidebar } from '@/components/evaluation-sidebar';
import { TestModeBanner } from '@/components/sis/test-mode-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

export default async function EvaluationLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { email, role } = sessionUser;
  const allowed: Array<typeof role> = [
    'teacher',
    'registrar',
    'school_admin',
    'admin',
    'superadmin',
  ];
  if (!role || !allowed.includes(role)) {
    if (role === 'p-file') redirect('/p-files');
    if (!role) redirect('/parent');
    redirect('/');
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <EvaluationSidebar email={email} role={role} />
      <SidebarInset>
        <TestModeBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <ModuleSwitcher currentModule="evaluation" role={role} />
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
