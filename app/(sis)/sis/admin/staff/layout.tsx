import { redirect } from 'next/navigation';

import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getStaffCount, getTeacherList } from '@/lib/auth/staff-list';
import { getSessionUser } from '@/lib/supabase/server';

// The merged staff directory (KD #154). Its two cuts used to be `?view=`
// tabs on one page; they are now child routes, so each is reachable from the
// sidebar and gated on its own.
//
// THIS LAYOUT IS THE SHARED GUARD. It runs for `/sis/admin/staff` and
// everything beneath it, so the role check here covers both cuts. The
// capability that separates them (`staff.view_accounts`) is checked in the
// Accounts page itself — a route needs its own guard, because the URL can be
// typed.
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/sis');
  }

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  const canSeeAccounts = can(capabilities, 'staff.view_accounts');

  // Both are free: they share the single 5-minute-cached listUsers() call
  // underlying every helper in lib/auth/staff-list.ts.
  const [staffCount, teacherList] = await Promise.all([
    getStaffCount(),
    getTeacherList(),
  ]);
  const teachingCount = teacherList.length;

  return (
    <PageShell>
      <SisPageHeader
        group="This year"
        title="Staff."
        description="Everyone who works in the school — their accounts, roles, and what they teach."
        chips={
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            {staffCount} people · {teachingCount} teaching
          </Badge>
        }
      />

      {/* Switcher and the content it controls are one region (space-y-4,
          tighter than PageShell's space-y-8) so the tabs read as bound to what
          is directly below them. */}
      <div className="space-y-4">
        {canSeeAccounts && (
          <PageTabNav
            tabs={[
              {
                href: '/sis/admin/staff',
                label: 'Teaching assignments',
                count: teachingCount,
              },
              {
                href: '/sis/admin/staff/accounts',
                label: 'Accounts',
                // staffCount, not the loaded account list. It excludes disabled
                // accounts, so it can read one or two lower than the Accounts
                // table — but it is the same number on both tabs, where the old
                // page showed a different one depending on which tab you were
                // standing on.
                count: staffCount,
              },
            ]}
          />
        )}
        {children}
      </div>
    </PageShell>
  );
}
