import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Lock,
  LockOpen,
  Scale,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getUserRole, type Role } from '@/lib/auth/roles';
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
  const supabase = await createClient();

  const { data: userRes } = await supabase.auth.getUser();
  const role: Role | null = getUserRole(userRes.user);
  const canManage = role === 'registrar' || role === 'admin' || role === 'superadmin';

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

  const readOnly = sheet.is_locked && !canManage;
  const requireApproval = sheet.is_locked && canManage;

  const { data: entriesRaw } = await supabase
    .from('grade_entries')
    .select(
      `id, ww_scores, pt_scores, qa_score,
       ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade,
       letter_grade, is_na,
       section_student:section_students(id, index_number, enrollment_status,
         student:students(student_number, last_name, first_name, middle_name))`,
    )
    .eq('grading_sheet_id', id);

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
        href="/grading"
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
              : 'flex items-start gap-4 rounded-xl border border-brand-indigo-soft/50 bg-accent p-5'
          }
        >
          <div
            className={
              readOnly
                ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile'
                : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
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
                href={`/admin/audit-log?sheet_id=${sheet.id}`}
                className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-brand-indigo-deep underline-offset-4 hover:underline"
              >
                View audit log
                <ArrowUpRight className="size-3.5" />
              </Link>
            )}
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
