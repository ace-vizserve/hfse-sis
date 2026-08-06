import { UserCog, Users2 } from 'lucide-react';
import { redirect } from 'next/navigation';

import { StaffAccountsClient } from '@/components/sis/staff-accounts-client';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { computeStaffFamilies } from '@/lib/sis/staff-families';
import { listStaffUsers } from '@/lib/sis/users/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Staff accounts — create, set role, enable/disable.
//
// THIS ROUTE CARRIES ITS OWN CAPABILITY GUARD. As a `?view=` tab the check
// lived in the page that rendered both cuts, so hiding the tab was enough.
// A route can be typed, so hiding the link is not: without this check anyone
// who may open Staff at all could read the account directory.
export default async function StaffAccountsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  // Matches the old behaviour for someone arriving on a bookmarked
  // `?view=accounts`: fall back to the cut they can see, rather than 404 or
  // bounce them out of the module.
  if (!can(capabilities, 'staff.view_accounts')) redirect('/sis/admin/staff');

  // Deliberately still the role literal. `staff.manage_accounts` exists and is
  // held only by superadmin, but the account-management API routes under
  // app/api/sis/admin/users/** gate on the role themselves (KD #87); moving the
  // flag here without moving those would let the UI and the server disagree.
  const canManageAccounts = sessionUser.role === 'superadmin';

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  const [accounts, accountAssignments] = await Promise.all([
    listStaffUsers(),
    loadStaffAssignments(ayCode),
  ]);

  const assignmentsByUserId = Object.fromEntries(
    accountAssignments.map((r) => [
      r.userId,
      { fcaSection: r.fcaSection, subjectAssignments: r.subjectAssignments },
    ])
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {computeStaffFamilies(accounts).map((family) => (
          <Card key={family.key} data-slot="card" className="gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                {family.label}
              </CardDescription>
              <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
                {family.total}
              </CardTitle>
              <CardAction>
                <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <Users2 className="size-4" />
                </div>
              </CardAction>
            </CardHeader>
            <div className="flex flex-col gap-2 px-6 py-4">
              {family.roles.map((r) => (
                <div
                  key={r.role}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {r.count}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {accounts.length} staff user{accounts.length === 1 ? '' : 's'}
            {!canManageAccounts ? ' · Read-only for your role' : ''}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <UserCog className="size-4" />
              </div>
              Directory
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StaffAccountsClient
            users={accounts}
            currentUserId={sessionUser.id}
            canManage={canManageAccounts}
            ayCode={ayCode}
            assignmentsByUserId={assignmentsByUserId}
          />
        </CardContent>
      </Card>
    </>
  );
}
