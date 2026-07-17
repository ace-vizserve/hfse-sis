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
import { getStaffCount } from '@/lib/auth/staff-list';
import type { SidebarCounts } from '@/lib/auth/roles';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getSectionsCount } from '@/lib/sis/sidebar-counts';

export default async function SisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { id, email, role } = sessionUser;
  // admissions is admitted to this layout for the single cross-module surface
  // they own operationally — Discount Codes (/sis/admin/discount-codes). The
  // per-route gate (ROUTE_ACCESS + proxy) keeps them scoped to that one route;
  // every other /sis nav entry is hidden from them via requiresRoles, and the
  // bare Admin Hub link is gated so they see no dead links.
  if (
    role !== 'admissions' &&
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

  const currentAy = await getCurrentAcademicYear();
  const readiness =
    (role === 'school_admin' || role === 'superadmin') && currentAy
      ? await getAyReadiness(currentAy.ay_code)
      : null;

  // Sidebar "This year" group count chips (SIS Admin visual pass, Task V2).
  // AY Setup reuses the `readiness` fetch above (same data already powers
  // the floating readiness pill) — no extra query. Sections/Staff are only
  // fetched for the roles that actually see those nav items (registrar +
  // school_admin + superadmin); admissions (single Discount Codes link)
  // and any other role skip the fetch entirely.
  const canSeeYearNav =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';
  const [sectionsCount, staffCount] =
    canSeeYearNav && currentAy
      ? await Promise.all([
          getSectionsCount(currentAy.ay_code),
          getStaffCount(),
        ])
      : [null, null];

  const sidebarCounts: SidebarCounts = {};
  if (readiness) {
    sidebarCounts.aySetupReadiness = `${readiness.complete}/${readiness.total}`;
  }
  if (sectionsCount != null) {
    sidebarCounts.sectionsCount = String(sectionsCount);
  }
  if (staffCount != null) {
    sidebarCounts.staffCount = String(staffCount);
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ModuleSidebar
        module="sis"
        role={role}
        email={email}
        userId={id}
        counts={sidebarCounts}
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
