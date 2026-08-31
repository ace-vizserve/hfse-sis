import { redirect } from 'next/navigation';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { type ChangeRequestStatus } from '@/lib/markbook/change-request-status';
import {
  getStaffDisplayNameById,
  narrowStaffNamesToRows,
} from '@/lib/auth/staff-list';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import { MyRequestsTable, type MyRequestRow } from './my-requests-table';

type RequestRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  status: ChangeRequestStatus;
  requested_by: string;
  requested_by_email: string;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  decision_note: string | null;
  applied_by: string | null;
  applied_at: string | null;
  approved_at: string | null;
  rejection_undone_at: string | null;
  primary_reviewed_by: string | null;
  primary_reviewed_by_email: string | null;
  secondary_reviewed_by: string | null;
  secondary_reviewed_by_email: string | null;
  secondary_reviewed_at: string | null;
  secondary_decision: 'approved' | 'rejected' | null;
};

function fieldLabel(field: string, slot: number | null): string {
  switch (field) {
    case 'ww_scores':
      return slot != null ? `W${slot + 1}` : 'WW';
    case 'pt_scores':
      return slot != null ? `PT${slot + 1}` : 'PT';
    case 'qa_score':
      return 'QA';
    case 'letter_grade':
      return 'Letter';
    case 'is_na':
      return 'N/A';
    default:
      return field;
  }
}

export default async function MyRequestsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { role, id: userId } = sessionUser;
  if (!role) redirect('/login');

  // Teachers see only their own; anyone else can still view this page as a
  // history of their own-filed requests (admin usually files none).
  //
  // AY-scoped via `sections.academic_year_id` (uuid FK, not text ay_code).
  const service = createServiceClient();

  const { data: ayData } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyId = (ayData as { id: string } | null)?.id ?? null;

  let listQuery = service
    .from('grade_change_requests')
    .select(
      `id, grading_sheet_id, grade_entry_id, field_changed, slot_index,
       current_value, proposed_value, reason_category, justification,
       status, requested_by, requested_by_email,
       requested_at, reviewed_at, reviewed_by_email, decision_note,
       applied_by, applied_at,
       approved_at, rejection_undone_at,
       primary_reviewed_by, primary_reviewed_by_email,
       secondary_reviewed_by, secondary_reviewed_by_email, secondary_reviewed_at,
       secondary_decision,
       grading_sheet:grading_sheets!inner(
         section:sections!inner(name, academic_year_id),
         subject:subjects(code, name),
         subject_config:subject_configs(display_name),
         term:terms(label)
       ),
       grade_entry:grade_entries(
         section_student:section_students(
           student:students(first_name, last_name)
         )
       )`
    )
    .eq('requested_by', userId)
    .order('requested_at', { ascending: false });

  if (currentAyId) {
    listQuery = listQuery.eq(
      'grading_sheet.section.academic_year_id',
      currentAyId
    );
  }

  const { data: rawRows } = await listQuery;

  type RawGradingSheet = {
    section: { name: string; academic_year_id: string } | null;
    subject: { code: string; name: string } | null;
    /**
     * The sheet's own subject_configs row — per (subject, academic year), so
     * this carries what the school called the subject in the year the sheet
     * belongs to (migration 137).
     */
    subject_config: { display_name: string | null } | null;
    term: { label: string } | null;
  };
  // Left embed (never `!inner`) — a student the join can't resolve must
  // still show up in the list, just with the 'a student' fallback.
  type RawStudent = { first_name: string | null; last_name: string | null };
  type RawGradeEntry = {
    section_student: { student: RawStudent | null } | null;
  };
  const rawList = (rawRows ?? []) as unknown as (RequestRow & {
    grading_sheet?: RawGradingSheet;
    grade_entry?: RawGradeEntry;
  })[];

  // Map server rows → MyRequestRow (derive field_label on the server so
  // it's available as a stable string for faceting + CSV export).
  const tableRows: MyRequestRow[] = rawList.map((r) => {
    const gs = r.grading_sheet;
    const student = r.grade_entry?.section_student?.student;
    const studentLabel =
      student && (student.first_name || student.last_name)
        ? `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim()
        : 'a student';
    return {
      id: r.id,
      grading_sheet_id: r.grading_sheet_id,
      grade_entry_id: r.grade_entry_id,
      field_label: fieldLabel(r.field_changed, r.slot_index),
      field_changed: r.field_changed,
      slot_index: r.slot_index,
      current_value: r.current_value,
      proposed_value: r.proposed_value,
      reason_category: r.reason_category,
      justification: r.justification,
      status: r.status,
      requested_by: r.requested_by,
      requested_by_email: r.requested_by_email,
      requested_at: r.requested_at,
      reviewed_at: r.reviewed_at,
      reviewed_by_email: r.reviewed_by_email,
      decision_note: r.decision_note,
      applied_by: r.applied_by,
      applied_at: r.applied_at,
      approved_at: r.approved_at,
      rejection_undone_at: r.rejection_undone_at,
      primary_reviewed_by: r.primary_reviewed_by,
      primary_reviewed_by_email: r.primary_reviewed_by_email,
      secondary_reviewed_by: r.secondary_reviewed_by,
      secondary_reviewed_by_email: r.secondary_reviewed_by_email,
      secondary_reviewed_at: r.secondary_reviewed_at,
      secondary_decision: r.secondary_decision,
      studentLabel,
      sectionName: gs?.section?.name ?? null,
      subjectCode: gs?.subject?.code ?? null,
      // Same list, teacher-facing half — same rule.
      subjectName: gs?.subject
        ? subjectDisplayName(gs.subject, gs.subject_config)
        : null,
      termLabel: gs?.term?.label ?? null,
    };
  });

  const staffNames = narrowStaffNamesToRows(
    await getStaffDisplayNameById(),
    tableRows,
    (r) => [
      r.requested_by,
      r.primary_reviewed_by,
      r.secondary_reviewed_by,
      r.applied_by,
    ]
  );

  const counts = rawList.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {
      pending: 0,
      approved: 0,
      rejected: 0,
      applied: 0,
      cancelled: 0,
    } as Record<RequestRow['status'], number>
  );

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading · Change requests
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          My requests
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Track the change requests you have filed on locked grading sheets.
          Approved requests are applied by the registrar.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Pending" value={counts.pending} />
        <StatCard label="Approved" value={counts.approved} />
        <StatCard label="Applied" value={counts.applied} />
        <StatCard label="Declined" value={counts.rejected} />
        <StatCard label="Cancelled" value={counts.cancelled} />
      </div>

      <MyRequestsTable
        data={tableRows}
        nameEntries={staffNames}
        viewerId={userId}
      />
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
