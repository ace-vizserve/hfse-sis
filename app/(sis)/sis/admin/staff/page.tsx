import {
  AlertTriangle,
  CheckCircle2,
  UserCog,
  Users2,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SisPageHeader } from '@/components/sis/sis-page-header';
import { StaffAccountsClient } from '@/components/sis/staff-accounts-client';
import { StaffTable } from '@/components/sis/staff-table';
import { Badge } from '@/components/ui/badge';
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
import { getStaffCount, getTeacherList } from '@/lib/auth/staff-list';
import { getSectionStaffingCoverage } from '@/lib/sis/dashboard';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { computeStaffFamilies } from '@/lib/sis/staff-families';
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
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/sis');
  }

  const params = await searchParams;
  const canSeeAccounts = sessionUser.role !== 'academic_coordinator';
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
  // queries. staffCount + teacherList are fetched unconditionally for the
  // header chip + tab counts (Task V3) — both are cheap: they share the
  // single 5-min-cached listUsers() call underlying every helper in
  // lib/auth/staff-list.ts, so this adds no new backend round-trip.
  const [assignments, accounts, staffCount, teacherList, accountAssignments] =
    await Promise.all([
      view === 'assignments'
        ? Promise.all([
            loadStaffAssignments(ayCode),
            getSectionStaffingCoverage(ayCode),
          ])
        : null,
      view === 'accounts' ? listStaffUsers() : null,
      getStaffCount(),
      getTeacherList(),
      view === 'accounts' ? loadStaffAssignments(ayCode) : null,
    ]);

  const [rows, coverage] = assignments ?? [[], null];
  const assignmentsByUserId = new Map(
    (accountAssignments ?? []).map((r) => [
      r.userId,
      { fcaSection: r.fcaSection, subjectAssignments: r.subjectAssignments },
    ])
  );
  const totalTeachers = rows.filter((r) => !r.disabled).length;
  const withFca = coverage?.withAdviser ?? 0;
  const sectionsMissingFca = coverage
    ? coverage.total - coverage.withAdviser
    : 0;

  // Header chip + tab counts (Task V3). "Teaching" = active role='teacher'
  // accounts (getTeacherList excludes disabled by default — same population
  // as totalTeachers above, whichever cut loaded it). Accounts-tab count
  // prefers the real loaded list; when Assignments is the active cut (so
  // `accounts` is null) it falls back to the free staffCount — an
  // approximation (staffCount excludes disabled accounts; the live
  // Accounts-cut count includes them), acceptable per the task's own
  // guidance since it avoids a second query on every Assignments load.
  const teachingCount = teacherList.length;
  const accountsTabCount = accounts ? accounts.length : staffCount;

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

      {/* Tabs + the content they control wrapped as one region (space-y-4,
          tighter than PageShell's space-y-8 default) so the switcher reads
          as bound to what's directly below it, not a floating paragraph
          between the header and an unrelated KPI grid (layout redesign
          pass, Law of Proximity). */}
      <div className="space-y-4">
        {canSeeAccounts && (
          <Tabs value={view} className="w-full">
            <TabsList variant="segmented">
              <TabsTrigger value="assignments" asChild>
                <Link
                  href="/sis/admin/staff"
                  className="inline-flex items-center gap-1.5"
                >
                  Teaching assignments
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {teachingCount}
                  </span>
                </Link>
              </TabsTrigger>
              <TabsTrigger value="accounts" asChild>
                <Link
                  href="/sis/admin/staff?view=accounts"
                  className="inline-flex items-center gap-1.5"
                >
                  Accounts
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {accountsTabCount}
                  </span>
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {view === 'assignments' && assignments ? (
          <>
            {/* KPI strip — "Sections missing FCA" (the one actionable/
                exception metric) moved first, ahead of the two steady counts
                (layout redesign pass, Serial Position/Pareto). */}
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
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
            </div>

            {/* Wrapped in a Card matching Accounts' shape below (layout
                redesign pass) — was a bare <StaffTable> while Accounts got
                a labeled Card, a self-inconsistency for the same DataTable
                widget on the same page. */}
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {teachingCount} teaching staff
                </CardDescription>
                <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Users2 className="size-4" />
                    </div>
                    Teaching assignments
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <StaffTable rows={rows} ayCode={ayCode} />
              </CardContent>
            </Card>
          </>
        ) : view === 'accounts' && accounts ? (
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
                  {accounts.length} staff user
                  {accounts.length === 1 ? '' : 's'}
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
                  assignmentsByUserId={Object.fromEntries(assignmentsByUserId)}
                />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
