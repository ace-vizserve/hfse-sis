import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  UserCog,
  Users2,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StaffAccountsClient } from '@/components/sis/staff-accounts-client';
import { StaffTable } from '@/components/sis/staff-table';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSectionStaffingCoverage } from '@/lib/sis/dashboard';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { listStaffUsers } from '@/lib/sis/users/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

type StaffView = 'assignments' | 'accounts';

// The merged staff directory (SIS Admin IA Phase 4, KD #154). Two cuts, one
// URL: Assignments (form-adviser + subject-teacher assignments — the
// pre-existing StaffTable, byte-preserved) and Accounts (create/role/
// enable-disable — ported from the retired /sis/admin/users page).
// Account-management actions stay superadmin-only server-side (KD #87's
// direct-create semantics are unchanged; see the API routes under
// app/api/sis/admin/users/**) — school_admin sees the Accounts cut
// read-only, and registrar never sees it at all (her nav link + this page's
// own guard only ever grant her Assignments).
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/sis');
  }

  const params = await searchParams;
  const canSeeAccounts = sessionUser.role !== 'registrar';
  const requestedView: StaffView =
    params.view === 'accounts' ? 'accounts' : 'assignments';
  // A registrar hitting ?view=accounts directly (bookmark, typed URL) falls
  // back to Assignments rather than 404ing or bouncing her off the page.
  const view: StaffView = canSeeAccounts ? requestedView : 'assignments';
  const canManageAccounts = sessionUser.role === 'superadmin';

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const ayCode = (ayRow as { ay_code: string } | null)?.ay_code;
  if (!ayCode) redirect('/sis');

  // Only fetch what the active cut needs — mirrors the audit-log Overview |
  // Log split (Phase 3) so switching tabs never pays for the other cut's
  // queries.
  const [assignments, accounts] = await Promise.all([
    view === 'assignments'
      ? Promise.all([
          loadStaffAssignments(ayCode),
          getSectionStaffingCoverage(ayCode),
        ])
      : null,
    view === 'accounts' ? listStaffUsers() : null,
  ]);

  const [rows, coverage] = assignments ?? [[], null];
  const totalTeachers = rows.filter((r) => !r.disabled).length;
  const withFca = coverage?.withAdviser ?? 0;
  const sectionsMissingFca = coverage
    ? coverage.total - coverage.withAdviser
    : 0;

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        SIS Admin
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Staff
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Staff.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          {canSeeAccounts
            ? `Everyone who works at HFSE — their accounts, roles, and what they teach for ${ayCode}.`
            : `Form class adviser and subject teaching assignments for ${ayCode}. Click a teacher row to edit their assignments.`}
        </p>
      </header>

      {canSeeAccounts && (
        <Tabs value={view} className="w-full">
          <TabsList variant="segmented">
            <TabsTrigger value="assignments" asChild>
              <Link href="/sis/admin/staff">Teaching assignments</Link>
            </TabsTrigger>
            <TabsTrigger value="accounts" asChild>
              <Link href="/sis/admin/staff?view=accounts">Accounts</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {view === 'assignments' && assignments ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
            <Card
              data-slot="card"
              className="bg-gradient-to-t from-primary/5 to-card"
            >
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Active teachers
                </CardDescription>
                <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
                  {totalTeachers}
                </CardTitle>
                <CardAction>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Users2 className="size-4" />
                  </div>
                </CardAction>
              </CardHeader>
            </Card>

            <Card
              data-slot="card"
              className="bg-gradient-to-t from-primary/5 to-card"
            >
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Sections with FCA
                </CardDescription>
                <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
                  {withFca}
                </CardTitle>
                <CardAction>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint">
                    <UserCheck className="size-4" />
                  </div>
                </CardAction>
              </CardHeader>
            </Card>

            <Card
              data-slot="card"
              className={
                sectionsMissingFca > 0
                  ? 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card'
                  : 'bg-gradient-to-t from-primary/5 to-card'
              }
            >
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Sections missing FCA
                </CardDescription>
                <CardTitle
                  className={`font-serif text-3xl tabular-nums ${sectionsMissingFca > 0 ? 'text-brand-amber' : 'text-foreground'}`}
                >
                  {sectionsMissingFca}
                </CardTitle>
                <CardAction>
                  <div
                    className={`flex size-9 items-center justify-center rounded-xl ${
                      sectionsMissingFca > 0
                        ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
                        : 'bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint'
                    }`}
                  >
                    {sectionsMissingFca > 0 ? (
                      <AlertTriangle className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                  </div>
                </CardAction>
              </CardHeader>
            </Card>
          </div>

          <StaffTable rows={rows} ayCode={ayCode} />
        </>
      ) : view === 'accounts' && accounts ? (
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
            />
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}
