import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getStaffCount, getTeacherList } from '@/lib/auth/staff-list';
import type { Role } from '@/lib/auth/roles';

// The "Staff." header and the two-cut switcher, shared by the two LIST pages.
//
// This used to live in `app/(sis)/sis/admin/staff/layout.tsx`. It moved out
// when the teacher detail page was added: a layout wraps every child, so the
// detail page inherited a header above its own and a switcher showing two tabs
// with neither selected — its URL is neither of them. Chrome that belongs to
// two specific pages belongs in those pages.
export async function StaffDirectoryChrome({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const capabilities = await getCapabilitiesForRole(role);
  const canSeeAccounts = can(capabilities, 'staff.view_accounts');

  // Both are free: they share the single 5-minute-cached listUsers() call
  // underlying every helper in lib/auth/staff-list.ts.
  const [staffCount, teacherList] = await Promise.all([
    getStaffCount(),
    getTeacherList(),
  ]);
  const teachingCount = teacherList.length;

  return (
    <>
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
    </>
  );
}
