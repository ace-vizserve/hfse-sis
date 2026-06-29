import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  CHANGE_REQUEST_STATUS_CONFIG,
  type ChangeRequestStatus,
} from '@/lib/markbook/change-request-status';
import {
  ChangeRequestsDataTable,
  type AdminRequestRow,
} from './change-requests-data-table';

export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet_id?: string; req?: string; action?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { role } = sessionUser;
  if (
    !role ||
    (role !== 'school_admin' && role !== 'superadmin' && role !== 'registrar')
  ) {
    redirect('/');
  }
  const canDecide = role === 'school_admin' || role === 'superadmin';

  const { sheet_id, req: reqParam, action: actionParam } = await searchParams;

  const service = createServiceClient();

  // Current AY — used to scope the queue. Without this filter admins saw
  // change requests from every AY mixed in. `sections.academic_year_id`
  // is the FK column (uuid), not text `ay_code`.
  const { data: ayData } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyId = (ayData as { id: string } | null)?.id ?? null;

  // Designated-approver scope: school_admins see only requests where they are
  // the primary or secondary approver. Legacy rows with both approver columns
  // NULL (pre-feature) stay broadcast-visible so nothing strands mid-migration.
  // Registrar keeps full visibility — they're the ones applying approved
  // requests (Path A/B). Superadmin keeps full visibility for oversight even
  // when not in the approval loop — they manage approver assignments at
  // /sis/admin/approvers but don't act on requests themselves (KD #39 + #41).
  //
  // AY scope: nested `!inner` join via grading_sheet → section.academic_year_id.
  let query = service
    .from('grade_change_requests')
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_by_email, requested_at,
       reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at,
       primary_approver_id, secondary_approver_id,
       primary_reviewed_by_email, secondary_reviewed_by_email,
       primary_reviewed_at,
       approved_at, rejection_undone_at,
       grading_sheet:grading_sheets!inner(
         section:sections!inner(id, name, academic_year_id),
         subject:subjects(code, name),
         term:terms(label)
       )`
    )
    .order('requested_at', { ascending: false })
    .limit(500);

  if (currentAyId) {
    query = query.eq('grading_sheet.section.academic_year_id', currentAyId);
  }

  if (role === 'school_admin') {
    query = query.or(
      `primary_approver_id.eq.${sessionUser.id},secondary_approver_id.eq.${sessionUser.id},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
    );
  }

  const { data: rawRows } = await query;

  type RawGradingSheet = {
    section: { id: string; name: string; academic_year_id: string } | null;
    subject: { code: string; name: string } | null;
    term: { label: string } | null;
  };
  type RawRequestRow = Omit<
    AdminRequestRow,
    'sectionId' | 'sectionName' | 'subjectCode' | 'subjectName' | 'termLabel'
  > & { grading_sheet?: RawGradingSheet };
  const rows: AdminRequestRow[] = (
    (rawRows ?? []) as unknown as RawRequestRow[]
  ).map((r) => {
    const gs = r.grading_sheet;
    return {
      ...r,
      sectionId: gs?.section?.id ?? null,
      sectionName: gs?.section?.name ?? null,
      subjectCode: gs?.subject?.code ?? null,
      subjectName: gs?.subject?.name ?? null,
      termLabel: gs?.term?.label ?? null,
    };
  });

  const counts: Record<ChangeRequestStatus, number> = {
    pending: 0,
    approved: 0,
    applied: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    if (r.status in counts) counts[r.status] += 1;
  }

  const stripOrder: ChangeRequestStatus[] = [
    'pending',
    'approved',
    'applied',
    'rejected',
    'cancelled',
  ];

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admin · Grade changes
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Change requests
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Review and decide on locked-sheet change requests from teachers.
          Approved requests are applied by the registrar; rejected requests are
          terminal and the teacher is notified.
        </p>
      </header>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-5">
          {stripOrder.map((status) => {
            const cfg = CHANGE_REQUEST_STATUS_CONFIG[status];
            const Icon = cfg.icon;
            const label =
              status === 'rejected'
                ? 'Declined'
                : status.charAt(0).toUpperCase() + status.slice(1);
            return (
              <Card key={status} className="@container/card">
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    {label}
                  </CardDescription>
                  <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
                    {counts[status].toLocaleString('en-SG')}
                  </CardTitle>
                  <CardAction>
                    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Icon className="size-4" />
                    </div>
                  </CardAction>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>

      <ChangeRequestsDataTable
        rows={rows}
        canDecide={canDecide}
        actorEmail={sessionUser.email || null}
        showNotAppliedFilter={role === 'registrar'}
        initialSheetIdFilter={sheet_id}
        initialRequestId={reqParam ?? null}
        initialAction={
          actionParam === 'approve' || actionParam === 'reject'
            ? actionParam
            : null
        }
      />
    </PageShell>
  );
}
