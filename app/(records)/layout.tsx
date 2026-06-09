import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { ModuleSidebar } from '@/components/module-sidebar';
import { AyBanner } from '@/components/sis/ay-banner';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import type { SidebarBadges } from '@/lib/auth/roles';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';

export default async function RecordsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  if (
    role !== 'registrar' &&
    role !== 'school_admin' &&
    role !== 'superadmin'
  ) {
    if (role === 'p-file') redirect('/p-files');
    if (!role) redirect('/login');
    redirect('/');
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar:state')?.value !== 'false';

  // Sidebar badges — SSR-static (no realtime subscription per KD #29).
  // `countUnsyncedEnrolledStudents` shares the `sis:${ayCode}` cache tag
  // with the loader, so the badge refreshes whenever an admissions
  // mutation runs (which is what AssignSectionDialog triggers anyway).
  const currentAy = await getCurrentAcademicYear();
  const unsyncedCount = currentAy
    ? await countUnsyncedEnrolledStudents(currentAy.ay_code)
    : 0;
  const badges: SidebarBadges = {
    unsyncedStudents: unsyncedCount > 0 ? unsyncedCount : undefined,
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="records"
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
