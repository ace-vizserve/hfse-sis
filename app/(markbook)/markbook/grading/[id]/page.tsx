import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Lock,
  LockOpen,
  MessageSquareWarning,
  Scale,
  Users,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import type { Role } from '@/lib/auth/roles';
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
import { LetterGradeGrid } from '@/components/grading/letter-grade-grid';
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
  slotIndex: number | null,
): string {
  if (field === 'ww_scores') return `WW${(slotIndex ?? 0) + 1}`;
  if (field === 'pt_scores') return `PT${(slotIndex ?? 0) + 1}`;
  if (field === 'qa_score') return 'QA';
  if (field === 'letter_grade') return 'Letter grade';
  return 'N/A flag';
}

type Level = { code: string; label: string };
type Section = { id: string; name: string; level: Level | Level[] | null };
type Subject = { id: string; code: string; name: string; is_examinable: boolean };
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
  Array.isArray(v) ? v[0] ?? null : v ?? null;

export default async function GradingSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionUser = await getSessionUser();
  const role: Role | null = sessionUser?.role ?? null;
  const canManage = role === 'registrar' || role === 'school_admin' || role === 'superadmin';
  const supabase = await createClient();

  // Fetch sheet first (needed for notFound gate), then parallelize the rest
  const { data: sheet } = await supabase
    .from('grading_sheets')
    .select(
      `id, teacher_name, is_locked, locked_at, locked_by, ww_totals, pt_totals, qa_total,
       term:terms(id, term_number, label),
       subject:subjects(id, code, name, is_examinable),
       section:sections(id, name, level:levels(code, label)),
       subject_config:subject_configs(ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots)`,
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
  const sectionForSeed = first(sheet.section as Section | Section[] | null);
  if (sectionForSeed?.id) {
    await supabase.rpc('seed_grade_entries_for_sheet', {
      p_sheet_id: id,
      p_section_id: sectionForSeed.id,
    });
  }

  const readOnly = sheet.is_locked && !canManage;
  const requireApproval = sheet.is_locked && canManage;

  // Parallel fetch — change requests + entries are independent
  const [{ data: openRequestsRaw }, { data: entriesRaw }] = await Promise.all([
    supabase
      .from('grade_change_requests')
      .select(
        'id, status, grade_entry_id, field_changed, slot_index, proposed_value, current_value, requested_by_email, reason_category',
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
           student:students(student_number, last_name, first_name, middle_name))`,
      )
      .eq('grading_sheet_id', id),
  ]);
  type OpenRequestRow = {
    id: string;
    status: 'pending' | 'approved';
    grade_entry_id: string;
    field_changed: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na';
    slot_index: number | null;
    proposed_value: string;
    current_value: string | null;
    requested_by_email: string;
    reason_category: string;
  };
  const openRequests = (openRequestsRaw ?? []) as OpenRequestRow[];
  const pendingCount = openRequests.filter((r) => r.status === 'pending').length;
  const approvedCount = openRequests.filter((r) => r.status === 'approved').length;

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
  const config = first(sheet.subject_config as SubjectConfig | SubjectConfig[] | null);
  const isExaminable = subject?.is_examinable !== false;

  // Teacher assignment gate — only the subject-teacher for this section/subject
  // may file a change request on the locked sheet.
  let isAssignedTeacher = false;
  if (role === 'teacher' && sessionUser && section?.id && subject?.id) {
    const assignments = await loadAssignmentsForUser(supabase, sessionUser.id);
    isAssignedTeacher = isSubjectTeacher(assignments, section.id, subject.id);
  }

  // Designated approvers for the locked-sheet change-request flow. Teachers
  // pick primary + secondary from this list when filing a request; the
  // list is managed at /sis/admin/approvers. Filter out the current user
  // since a teacher can't designate themselves.
  const approversAll = sheet.is_locked && isAssignedTeacher
    ? await listApproversForFlow('markbook.change_request')
    : [];
  const approvers = approversAll
    .filter((a) => a.user_id !== sessionUser?.id)
    .map((a) => ({ user_id: a.user_id, email: a.email, role: a.role }));

  // Build a quick lookup so the open-change-requests banner can label each
  // request with the affected student's name + index number. The banner
  // tells the registrar exactly which student/cell to look at without
  // forcing them to leave the page or scan the grid.
  const rowsByEntryId = new Map<string, { index_number: number; student_name: string }>();
  for (const e of entries) {
    const ss = first(e.section_student);
    const stu = first(ss?.student ?? null);
    rowsByEntryId.set(e.id, {
      index_number: ss?.index_number ?? 0,
      student_name: stu
        ? [stu.last_name, stu.first_name, stu.middle_name].filter(Boolean).join(', ')
        : '(missing)',
    });
  }

  const rows = entries.map((e) => {
    const ss = first(e.section_student);
    const stu = first(ss?.student ?? null);
    return {
      entry_id: e.id,
      index_number: ss?.index_number ?? 0,
      student_name: stu
        ? [stu.last_name, stu.first_name, stu.middle_name].filter(Boolean).join(', ')
        : '(missing)',
      student_number: stu?.student_number ?? '',
      withdrawn: ss?.enrollment_status === 'withdrawn',
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
  const gradedCount = activeRows.filter((r) =>
    isExaminable ? r.quarterly_grade !== null : r.letter_grade !== null,
  ).length;
  const gradedPct =
    totalStudents > 0 ? Math.round((gradedCount / totalStudents) * 100) : 0;

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
            {sheet.teacher_name && <> · {sheet.teacher_name}</>}
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
          {canManage && isExaminable && (
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
          {canManage && <LockToggle sheetId={sheet.id} isLocked={sheet.is_locked} />}
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
            footerTitle={totalStudents > 0 ? `${gradedPct}% complete` : 'No students yet'}
            footerDetail={
              isExaminable
                ? 'Quarterly grade computed'
                : 'Letter grade recorded'
            }
          />
          <StatCard
            description={isExaminable ? 'Weights · WW / PT / QA' : 'Format'}
            value={isExaminable ? `${wwW}/${ptW}/${qaW}` : 'Letters'}
            icon={Scale}
            footerTitle={
              isExaminable
                ? 'Written · Performance · Quarterly'
                : 'A / B / C / IP / UG / NA / INC / CO / E'
            }
            footerDetail={
              isExaminable
                ? 'Configured per subject × level × AY'
                : 'Non-examinable subject'
            }
          />
        </div>
      </div>

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
              {readOnly ? 'Sheet is locked for editing' : 'Sheet is locked — approval required'}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {readOnly
                ? 'Grades have been committed for this term. Contact the registrar to request corrections.'
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
                pendingCount > 0
                  ? `${pendingCount} awaiting review`
                  : null,
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
                    if (a.status !== b.status) return a.status === 'approved' ? -1 : 1;
                    const ai = rowsByEntryId.get(a.grade_entry_id)?.index_number ?? 0;
                    const bi = rowsByEntryId.get(b.grade_entry_id)?.index_number ?? 0;
                    return ai - bi;
                  })
                  .map((r) => {
                    const student = rowsByEntryId.get(r.grade_entry_id);
                    const cell = fieldLabelForChangeRequest(r.field_changed, r.slot_index);
                    const from =
                      r.current_value === null || r.current_value === '' ? '∅' : r.current_value;
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

      {isExaminable ? (
        <ScoreEntryGrid
          sheetId={sheet.id}
          wwTotals={(sheet.ww_totals ?? []) as number[]}
          ptTotals={(sheet.pt_totals ?? []) as number[]}
          qaTotal={sheet.qa_total as number | null}
          rows={rows}
          readOnly={readOnly}
          requireApproval={requireApproval}
        />
      ) : (
        <LetterGradeGrid
          sheetId={sheet.id}
          rows={rows}
          readOnly={readOnly}
          requireApproval={requireApproval}
        />
      )}
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
