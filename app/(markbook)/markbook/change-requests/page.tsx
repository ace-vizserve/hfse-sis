import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { ChangeRequestsDataTable, type AdminRequestRow } from './change-requests-data-table';

export default async function AdminChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { role } = sessionUser;
  if (!role || (role !== 'admin' && role !== 'superadmin' && role !== 'registrar')) {
    redirect('/');
  }
  const canDecide = role === 'admin' || role === 'superadmin';

  const { sheet_id } = await searchParams;

  const service = createServiceClient();

  // Current AY — used to scope the queue. Without this filter admins saw
  // change requests from every AY mixed in.
  const { data: ayData } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyCode = (ayData as { ay_code: string } | null)?.ay_code ?? null;

  // Designated-approver scope: admins (and superadmins) see only requests
  // where they are the primary or secondary approver. Legacy rows with
  // both approver columns NULL (pre-feature) stay broadcast-visible so
  // nothing strands mid-migration. Registrar keeps full visibility —
  // they're the ones applying approved requests (Path A/B).
  //
  // AY scope: nested `!inner` join via grading_sheet → section.ay_code.
  let query = service
    .from('grade_change_requests')
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_by_email, requested_at,
       reviewed_by_email, reviewed_at, decision_note,
       applied_by, applied_at,
       primary_approver_id, secondary_approver_id,
       grading_sheet:grading_sheets!inner(section:sections!inner(ay_code))`,
    )
    .order('requested_at', { ascending: false });

  if (currentAyCode) {
    query = query.eq('grading_sheet.section.ay_code', currentAyCode);
  }

  if (canDecide) {
    query = query.or(
      `primary_approver_id.eq.${sessionUser.id},secondary_approver_id.eq.${sessionUser.id},and(primary_approver_id.is.null,secondary_approver_id.is.null)`,
    );
  }

  const { data: rawRows } = await query;

  const rows = (rawRows ?? []) as AdminRequestRow[];

  const counts = {
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    applied: rows.filter((r) => r.status === 'applied').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
  };

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Pending" value={counts.pending} emphasised />
        <StatCard label="Approved" value={counts.approved} />
        <StatCard label="Applied" value={counts.applied} />
        <StatCard label="Declined" value={counts.rejected} />
        <StatCard label="Cancelled" value={counts.cancelled} />
      </div>

      <ChangeRequestsDataTable
        rows={rows}
        canDecide={canDecide}
        initialSheetIdFilter={sheet_id}
      />
    </PageShell>
  );
}

function StatCard({
  label,
  value,
  emphasised = false,
}: {
  label: string;
  value: number;
  emphasised?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle
          className={`font-serif text-[28px] font-semibold leading-none tabular-nums ${
            emphasised && value > 0 ? 'text-primary' : 'text-foreground'
          }`}
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
