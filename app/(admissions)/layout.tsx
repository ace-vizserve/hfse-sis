import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { ModuleSidebar } from '@/components/module-sidebar';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { countPendingDocValidation } from '@/lib/admissions/document-validation';
import type { SidebarBadges } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';

export default async function AdmissionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  const allowed = [
    'admissions',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ] as const;
  if (!role || !(allowed as readonly string[]).includes(role)) {
    if (role === 'p_file_officer') redirect('/p-files');
    if (role === 'teacher') redirect('/markbook');
    if (!role) redirect('/login');
    redirect('/');
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  // Sidebar badges — currently only the doc-validation pending count.
  // SSR-static (no realtime subscription): the docs columns live in the
  // admissions Supabase project and the realtime hook only subscribes to
  // the main project, so the badge refreshes on the next navigation.
  // `loadPendingDocValidation` (the source for the count) is `unstable_cache`d
  // with tag `sis:${ayCode}` and auto-invalidates on the validate PATCH.
  const currentAy = await getCurrentAcademicYear();
  const badges: SidebarBadges = currentAy
    ? {
        pendingDocValidation: await countPendingDocValidation(
          currentAy.ay_code
        ),
      }
    : {};

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="admissions"
        role={role}
        email={email}
        userId={id}
        badges={badges}
      />
      <SidebarInset>
        <AyBanner />
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex-1 bg-muted px-6 py-8 md:px-10 md:py-10">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
