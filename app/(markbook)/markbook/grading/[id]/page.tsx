import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  Lock,
  LockOpen,
  MessageSquareWarning,
  Scale,
  Users,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  loadPriorTermGrades,
  type PriorTermGrade,
} from '@/lib/markbook/grade-diff';
import type { Role } from '@/lib/auth/roles';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import {
  buildSubjectTeacherNameMap,
  subjectTeacherKey,
  type SubjectTeacherAssignmentRow,
} from '@/lib/markbook/subject-teacher';
import {
  loadAssignmentsForUser,
  isSubjectTeacher,
} from '@/lib/auth/teacher-assignments';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { ScoreEntryGrid } from '@/components/grading/score-entry-grid';
import { LockToggle } from '@/components/grading/lock-toggle';
import { TotalsEditor } from '@/components/grading/totals-editor';
import { listApproversForFlow } from '@/lib/sis/approvers/queries';
import { RequestEditButton } from './request-edit-button';

/**
 * Human label for a change-request target field, e.g. WW1 / PT2 / QA /
 * Letter grade / N/A. Used in the open-change-requests banner so the
 * registrar sees which exact cell each request points at without having
 * to open the queue.
 */
function fieldLabelForChangeRequest(
  field: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na',
  slotIndex: number | null
): string {
  if (field === 'ww_scores') return `WW${(slotIndex ?? 0) + 1}`;
  if (field === 'pt_scores') return `PT${(slotIndex ?? 0) + 1}`;
  if (field === 'qa_score') return 'QA';
  if (field === 'letter_grade') return 'Letter grade';
  return 'N/A flag';
}

type Level = { id: string; code: string; label: string };
type Section = { id: string; name: string; level: Level | Level[] | null };
type Subject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};
type Term = { id: string; term_number: number; label: string };
type SubjectConfig = {
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
};

type StudentLite = {
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
};
type SectionStudent = {
  id: string;
  index_number: number;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  student: StudentLite | StudentLite[] | null;
};
type EntryRow = {
  id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  letter_grade: string | null;
  is_na: boolean;
  section_student: SectionStudent | SectionStudent[] | null;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default async function GradingSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionUser = await getSessionUser();
  const role: Role | null = sessionUser?.role ?? null;
  const canManage =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  const supabase = await createClient();

  // Fetch sheet first (needed for notFound gate), then parallelize the rest
  const { data: sheet } = await supabase
    .from('grading_sheets')
    .select(
      `id, teacher_name, is_locked, locked_at, locked_by, ww_totals, pt_totals, qa_total, slot_labels,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(id, code, label)),
       subject_config:subject_configs(ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`
    )
    .eq('id', id)
    .single();
  if (!sheet) notFound();

  // Roster-sync seed — ensure every section_student has a grade_entries
  // row for this sheet so the grid below renders the full roster, not
  // just students with already-saved scores. Idempotent via the unique
  // constraint added in migration 035; runs on every sheet open so
  // late-enrollees added after sheet generation are picked up
  // automatically (self-healing). Bulk generate (migration 036) seeds
  // up-front, so this is typically a no-op insert.
  //
  // Runs on the SERVICE client, not the viewer's. This was the one caller of a
  // `security definer` RPC through the cookie client, which is why the function
  // had to be executable by `authenticated` — and a grant to `authenticated` is
  // a grant to every signed-in session, including a parent's role-less one,
  // callable straight over PostgREST. The page has already established who the
  // viewer is by this point, so running the seed as the service role loses
  // nothing and lets migration 103 close the grant.
  const sectionForSeed = first(sheet.section as Section | Section[] | null);
  if (sectionForSeed?.id) {
    await createServiceClient().rpc('seed_grade_entries_for_sheet', {
      p_sheet_id: id,
      p_section_id: sectionForSeed.id,
    });
  }

  // `readOnly` is computed further down, once `isAssignedTeacher` is known —
  // it depends on the teacher's assignment, not just the lock state.
  const requireApproval = sheet.is_locked && canManage;

  // Fetch teacher's assignments concurrently with entries/requests — only
  // needed for the subject-teacher gate; skip for non-teacher roles.
  const assignmentsPromise: Promise<
    Awaited<ReturnType<typeof loadAssignmentsForUser>>
  > =
    role === 'teacher' && sessionUser
      ? loadAssignmentsForUser(supabase, sessionUser.id)
      : Promise.resolve([]);

  // Prior-term grades for grade-difference analysis. Extracted early so the
  // fetch runs in parallel with entries and change-requests.
  const subjectEarly = first(sheet.subject as Subject | Subject[] | null);
  const termEarly = first(sheet.term as Term | Term[] | null);
  const priorGradesPromise: Promise<Record<string, PriorTermGrade[]>> =
    sectionForSeed?.id &&
    subjectEarly?.id &&
    termEarly &&
    termEarly.term_number > 1
      ? loadPriorTermGrades(
          sectionForSeed.id,
          subjectEarly.id,
          termEarly.term_number
        )
      : Promise.resolve({});

  // Who teaches this (section × subject) — the live answer, from
  // teacher_assignments. The page's own loadAssignmentsForUser call above is
  // keyed on the CURRENT user and only gates their edit rights; it cannot
  // answer "who teaches this". Declared here so it runs inside the Promise.all
  // below rather than adding a serial round-trip.
  //
  // Read with the SERVICE client, not the cookie-scoped one. The RLS policy on
  // teacher_assignments is
  //   using (is_registrar_or_above() or teacher_user_id = auth.uid())
  // — a teacher sees ONLY THEIR OWN assignment rows (migration 005). So a
  // cookie-scoped read of "who teaches this subject" returns nothing for a form
  // class adviser (their row is form_adviser, filtered out by role here), and
  // for a subject teacher returns only themselves — which silently defeats the
  // whole point of resolving ALL teachers for a co-taught pair (KD #158). It
  // looked correct only because managers pass is_registrar_or_above().
  //
  // This is display-only (a staff name on a sheet the viewer is already
  // authorized to read), and it matches the sibling surfaces: /markbook/grading
  // resolves the same question on a service client, and getStaffDisplayNameById
  // below is itself service-backed. The cookie client here was the outlier.
  //
  // (async IIFE, not a bare .then() — the PostgREST builder is a PromiseLike,
  // which does not satisfy the Promise<...> annotation Promise.all infers from.)
  const subjectTeacherPromise: Promise<SubjectTeacherAssignmentRow[]> =
    sectionForSeed?.id && subjectEarly?.id
      ? (async () => {
          const { data } = await createServiceClient()
            .from('teacher_assignments')
            .select('section_id, subject_id, teacher_user_id')
            .eq('role', 'subject_teacher')
            .eq('section_id', sectionForSeed.id)
            .eq('subject_id', subjectEarly.id);
          return (data ?? []) as SubjectTeacherAssignmentRow[];
        })()
      : Promise.resolve([]);

  const [
    { data: openRequestsRaw },
    { data: entriesRaw },
    rawAssignments,
    priorGrades,
    subjectTeacherAssignments,
    staffNameEntries,
  ] = await Promise.all([
    supabase
      .from('grade_change_requests')
      .select(
        'id, status, grade_entry_id, field_changed, slot_index, proposed_value, current_value, requested_by_email, reason_category'
      )
      .eq('grading_sheet_id', id)
      .in('status', ['pending', 'approved']),
    supabase
      .from('grade_entries')
      .select(
        `id, ww_scores, pt_scores, qa_score,
         ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade,
         letter_grade, is_na,
         section_student:section_students(id, index_number, enrollment_status,
           student:students(student_number, last_name, first_name, middle_name))`
      )
      .eq('grading_sheet_id', id),
    assignmentsPromise,
    priorGradesPromise,
    subjectTeacherPromise,
    getStaffDisplayNameById(),
  ]);
  type OpenRequestRow = {
    id: string;
    status: 'pending' | 'approved';
    grade_entry_id: string;
    field_changed:
      | 'ww_scores'
      | 'pt_scores'
      | 'qa_score'
      | 'letter_grade'
      | 'is_na';
    slot_index: number | null;
    proposed_value: string;
    current_value: string | null;
    requested_by_email: string;
    reason_category: string;
  };
  // Assignment first; the legacy `grading_sheets.teacher_name` column only as a
  // last resort. That column is written at sheet creation and never updated, so
  // it drifts — but on historical sheets it may be the only record we have, and
  // it is what /markbook/grading already falls back to. Blanking it here would
  // make the two surfaces disagree about who teaches a class.
  const subjectTeacherNames =
    sectionForSeed?.id && subjectEarly?.id
      ? (buildSubjectTeacherNameMap(
          subjectTeacherAssignments,
          staffNameEntries
        ).get(subjectTeacherKey(sectionForSeed.id, subjectEarly.id)) ?? [])
      : [];
  const subjectTeacherLabel =
    subjectTeacherNames.length > 0
      ? subjectTeacherNames.join(', ')
      : (sheet.teacher_name ?? null);

  const openRequests = (openRequestsRaw ?? []) as OpenRequestRow[];
  const pendingCount = openRequests.filter(
    (r) => r.status === 'pending'
  ).length;
  const approvedCount = openRequests.filter(
    (r) => r.status === 'approved'
  ).length;

  const entries = ((entriesRaw ?? []) as unknown as EntryRow[])
    .slice()
    .sort((a, b) => {
      const ai = first(a.section_student);
      const bi = first(b.section_student);
      return (ai?.index_number ?? 0) - (bi?.index_number ?? 0);
    });

  const section = first(sheet.section as Section | Section[] | null);
  const level = first(section?.level ?? null);
  const subject = first(sheet.subject as Subject | Subject[] | null);
  const term = first(sheet.term as Term | Term[] | null);
  const config = first(
    sheet.subject_config as SubjectConfig | SubjectConfig[] | null
  );
  const isExaminable = subject?.is_examinable !== false;

  // Teacher assignment gate — already fetched concurrently above.
  const isAssignedTeacher =
    role === 'teacher' && sessionUser && section?.id && subject?.id
      ? isSubjectTeacher(rawAssignments, section.id, subject.id)
      : false;

  // Score entry is read-only when the sheet is locked, OR when the viewer is a
  // teacher who is not this sheet's assigned subject teacher — a form class
  // adviser sees every subject in their section for monitoring, but only the
  // subject teacher encodes. Mirrors the server gate in
  // PATCH /api/grading-sheets/[id]/entries/[entryId]; the grid used to key off
  // the lock alone, so an adviser was shown editable inputs.
  const readOnly =
    (sheet.is_locked && !canManage) ||
    (role === 'teacher' && !isAssignedTeacher);

  // A teacher viewing a sheet they don't teach — in practice the form class
  // adviser, who reads every subject in their own section. The locked-sheet
  // banner below only renders when the sheet IS locked, so without this an
  // adviser on an unlocked sheet would get silently dead inputs and no reason
  // why.
  const isMonitoringOnly = role === 'teacher' && !isAssignedTeacher;

  // Designated approvers for the locked-sheet change-request flow. Teachers
  // pick primary + secondary from this list when filing a request; the
  // list is managed at /sis/admin/approvers. Filter out the current user
  // since a teacher can't designate themselves.
  const approversAll =
    sheet.is_locked && isAssignedTeacher
      ? await listApproversForFlow('markbook.change_request')
      : [];
  const approvers = approversAll
    .filter((a) => a.user_id !== sessionUser?.id)
    .map((a) => ({ user_id: a.user_id, email: a.email, role: a.role }));

  // Build a quick lookup so the open-change-requests banner can label each
  // request with the affected student's name + index number. The banner
  // tells the registrar exactly which student/cell to look at without
  // forcing them to leave the page or scan the grid.
  const rowsByEntryId = new Map<
    string,
    { index_number: number; student_name: string }
  >();
  for (const e of entries) {
    const ss = first(e.section_student);
    const stu = first(ss?.student ?? null);
    rowsByEntryId.set(e.id, {
      index_number: ss?.index_number ?? 0,
      student_name: stu
        ? [stu.last_name, stu.first_name, stu.middle_name]
            .filter(Boolean)
            .join(', ')
        : '(missing)',
    });
  }

  const rows = entries.map((e) => {
    const ss = first(e.section_student);
    const stu = first(ss?.student ?? null);
    return {
      entry_id: e.id,
      section_student_id: ss?.id ?? '',
      index_number: ss?.index_number ?? 0,
      student_name: stu
        ? [stu.last_name, stu.first_name, stu.middle_name]
            .filter(Boolean)
            .join(', ')
        : '(missing)',
      student_number: stu?.student_number ?? '',
      withdrawn: ss?.enrollment_status === 'withdrawn',
      late_enrollee: ss?.enrollment_status === 'late_enrollee',
      is_na: e.is_na,
      ww_scores: (e.ww_scores ?? []) as (number | null)[],
      pt_scores: (e.pt_scores ?? []) as (number | null)[],
      qa_score: e.qa_score,
      ww_ps: e.ww_ps,
      pt_ps: e.pt_ps,
      qa_ps: e.qa_ps,
      initial_grade: e.initial_grade,
      quarterly_grade: e.quarterly_grade,
      letter_grade: e.letter_grade,
    };
  });

  // Stat card metrics — only count active + late_enrollee students
  const activeRows = rows.filter((r) => !r.withdrawn);
  const totalStudents = activeRows.length;
  const gradedCount = activeRows.filter(
    (r) => r.quarterly_grade !== null || r.letter_grade !== null || r.is_na
  ).length;
  const gradedPct =
    totalStudents > 0 ? Math.round((gradedCount / totalStudents) * 100) : 0;

  // Who may edit the activity labels inline in the scoring guide — mirrors the
  // gate that previously controlled the (now removed) Activity Labels dialog:
  // assigned subject teachers on an unlocked sheet, or any manager.
  const canEditLabels = (isAssignedTeacher && !sheet.is_locked) || canManage;

  const wwW = Math.round(Number(config?.ww_weight ?? 0) * 100);
  const ptW = Math.round(Number(config?.pt_weight ?? 0) * 100);
  const qaW = Math.round(Number(config?.qa_weight ?? 0) * 100);

  return (
    <PageShell>
      <Link
        href="/markbook/grading"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All grading sheets
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Grading · {term?.label ?? 'Term'}
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {subject?.name ?? 'Subject'}
            </h1>
            {sheet.is_locked ? (
              <Badge
                variant="outline"
                className="h-7 border-destructive/40 bg-destructive/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive"
              >
                <Lock className="h-3 w-3" />
                Locked
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink"
              >
                <LockOpen className="h-3 w-3" />
                Open for entry
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {level?.label} {section?.name}
            {subjectTeacherLabel ? (
              <> · {subjectTeacherLabel}</>
            ) : (
              <>
                {' '}
                · <span className="italic">No subject teacher assigned</span>
              </>
            )}
            {!isExaminable && <> · Letter-grade subject</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sheet.is_locked && isAssignedTeacher && (
            <RequestEditButton
              sheetId={sheet.id}
              isExaminable={isExaminable}
              wwSlotCount={(sheet.ww_totals ?? []).length as number}
              ptSlotCount={(sheet.pt_totals ?? []).length as number}
              approvers={approvers}
              students={rows.map((r) => ({
                entry_id: r.entry_id,
                index_number: r.index_number,
                student_name: r.student_name,
                student_number: r.student_number,
                ww_scores: r.ww_scores,
                pt_scores: r.pt_scores,
                qa_score: r.qa_score,
                letter_grade: r.letter_grade,
                is_na: r.is_na,
                withdrawn: r.withdrawn,
              }))}
            />
          )}
          {canManage && (
            <TotalsEditor
              sheetId={sheet.id}
              wwTotals={(sheet.ww_totals ?? []) as number[]}
              ptTotals={(sheet.pt_totals ?? []) as number[]}
              qaTotal={sheet.qa_total as number | null}
              wwMaxSlots={Number(config?.ww_max_slots ?? 5)}
              ptMaxSlots={Number(config?.pt_max_slots ?? 5)}
              isLocked={sheet.is_locked}
            />
          )}
          {canManage && (
            <LockToggle sheetId={sheet.id} isLocked={sheet.is_locked} />
          )}
        </div>
      </header>

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Students"
            value={totalStudents.toLocaleString('en-SG')}
            icon={Users}
            footerTitle={`${totalStudents} on the roster`}
            footerDetail="Withdrawn students excluded"
          />
          <StatCard
            description="Graded"
            value={`${gradedCount}/${totalStudents || 0}`}
            icon={CheckCircle2}
            footerTitle={
              totalStudents > 0 ? `${gradedPct}% complete` : 'No students yet'
            }
            footerDetail={
              isExaminable
                ? 'Quarterly grade computed'
                : 'Letter grade recorded'
            }
          />
          <StatCard
            description="Weights · WW / PT / QA"
            value={`${wwW}/${ptW}/${qaW}`}
            icon={Scale}
            footerTitle="Written · Performance · Quarterly"
            footerDetail={
              isExaminable
                ? 'Configured per subject × level × AY'
                : 'Letter-displayed final grade'
            }
          />
        </div>
      </div>

      {isMonitoringOnly && !sheet.is_locked && (
        <div className="flex items-start gap-4 rounded-xl border border-border bg-muted/50 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-3 text-white">
            <Eye className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              You have view-only access to this subject
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              As the form class adviser you can follow every subject in your
              class, but only the assigned subject teacher enters the scores.
              Ask them to make a correction, or contact your school admin.
            </p>
          </div>
        </div>
      )}

      {sheet.is_locked && (
        <div
          className={
            readOnly
              ? 'flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5'
              : 'flex items-start gap-4 rounded-xl border border-border bg-muted/50 p-5'
          }
        >
          <div
            className={
              readOnly
                ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile'
                : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-3 text-white'
            }
          >
            <Lock className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              {readOnly
                ? 'Sheet is locked for editing'
                : 'Sheet is locked — approval required'}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {readOnly
                ? 'Grades have been committed for this term. Ask the subject teacher to file a change request, or contact your school admin.'
                : 'Any edit you make will be written to the audit log. You will be prompted for an approval reference on save.'}
            </p>
            {canManage && (
              <Link
                href={`/markbook/audit-log?sheet_id=${sheet.id}`}
                className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-ink-3 underline-offset-4 hover:underline"
              >
                View audit log
                <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}

      {openRequests.length > 0 && (
        <div
          className={
            pendingCount > 0
              ? 'flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-5'
              : 'flex items-start gap-4 rounded-xl border border-brand-indigo-soft/50 bg-accent/60 p-5'
          }
        >
          <div
            className={
              pendingCount > 0
                ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-amber text-white shadow-brand-tile'
                : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
            }
          >
            <MessageSquareWarning className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              {openRequests.length === 1
                ? 'There is an open change request on this sheet'
                : `There are ${openRequests.length} open change requests on this sheet`}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {[
                pendingCount > 0 ? `${pendingCount} awaiting review` : null,
                approvedCount > 0
                  ? `${approvedCount} approved, awaiting registrar`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              .
            </p>

            {/* Per-cell list — shown to anyone with the apply gate
                (`canManage` on a locked sheet) so the registrar sees which
                exact cells each open request points at without leaving
                the page. Sorted approved-first so the action queue is on
                top. */}
            {canManage && openRequests.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border/50 pt-2.5 text-sm">
                {[...openRequests]
                  .sort((a, b) => {
                    if (a.status !== b.status)
                      return a.status === 'approved' ? -1 : 1;
                    const ai =
                      rowsByEntryId.get(a.grade_entry_id)?.index_number ?? 0;
                    const bi =
                      rowsByEntryId.get(b.grade_entry_id)?.index_number ?? 0;
                    return ai - bi;
                  })
                  .map((r) => {
                    const student = rowsByEntryId.get(r.grade_entry_id);
                    const cell = fieldLabelForChangeRequest(
                      r.field_changed,
                      r.slot_index
                    );
                    const from =
                      r.current_value === null || r.current_value === ''
                        ? '∅'
                        : r.current_value;
                    const isApproved = r.status === 'approved';
                    return (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-snug"
                      >
                        <span
                          aria-hidden
                          className={
                            isApproved
                              ? 'inline-block size-1.5 shrink-0 rounded-full bg-brand-amber'
                              : 'inline-block size-1.5 shrink-0 rounded-full bg-brand-indigo'
                          }
                        />
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          #{student?.index_number ?? '—'}
                        </span>
                        <span className="font-medium text-foreground">
                          {student?.student_name ?? '(unknown student)'}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono text-[11px] uppercase tracking-wider text-foreground">
                          {cell}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono tabular-nums text-foreground">
                          {from} → {r.proposed_value}
                        </span>
                        <span
                          className={
                            isApproved
                              ? 'ml-1 rounded bg-brand-amber/25 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-foreground'
                              : 'ml-1 rounded bg-brand-indigo/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-brand-indigo-deep'
                          }
                        >
                          {isApproved ? 'Apply' : 'Pending'}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}

            <Link
              href={
                canManage
                  ? `/markbook/change-requests?sheet_id=${sheet.id}`
                  : '/markbook/grading/requests'
              }
              className={
                pendingCount > 0
                  ? 'inline-flex items-center gap-1 pt-1 text-sm font-medium text-brand-amber underline-offset-4 hover:underline'
                  : 'inline-flex items-center gap-1 pt-1 text-sm font-medium text-brand-indigo-deep underline-offset-4 hover:underline'
              }
            >
              {canManage ? 'View change requests' : 'My requests'}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* key on the slot-max signature: when TotalsEditor edits a max/slot it
          calls router.refresh(), which recomputes grades server-side — remount
          the grid so it re-seeds from the fresh rows instead of showing stale
          computed grades. Per-cell saves don't change the maxes, so the key is
          stable during entry (no remount, no lost in-progress edits). */}
      <ScoreEntryGrid
        key={`${(sheet.ww_totals ?? []).join(',')}|${(sheet.pt_totals ?? []).join(',')}|${sheet.qa_total ?? ''}`}
        sheetId={sheet.id}
        wwTotals={(sheet.ww_totals ?? []) as number[]}
        ptTotals={(sheet.pt_totals ?? []) as number[]}
        qaTotal={sheet.qa_total as number | null}
        wwWeight={Number(config?.ww_weight ?? 0)}
        ptWeight={Number(config?.pt_weight ?? 0)}
        qaWeight={Number(config?.qa_weight ?? 0)}
        rows={rows}
        readOnly={readOnly}
        requireApproval={requireApproval}
        slotLabels={
          (sheet.slot_labels as {
            ww?: ({
              label?: string | null;
              date?: string | null;
              page?: string | null;
            } | null)[];
            pt?: ({
              label?: string | null;
              date?: string | null;
              page?: string | null;
            } | null)[];
            qa?: string | null;
          } | null) ?? undefined
        }
        letterDisplay={!isExaminable}
        canEditLabels={canEditLabels}
        priorGrades={priorGrades}
        currentTermNumber={term?.term_number ?? 1}
        currentTermLabel={term?.label ?? 'Term'}
      />
    </PageShell>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
