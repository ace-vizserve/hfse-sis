import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getUserRole, type Role } from '@/lib/auth/roles';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

  return (
    <PageShell>
      <header className="flex flex-col gap-5 border-b border-border pb-6">
        <Link
          href="/grading"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All grading sheets
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-[2rem]">
                {subject?.name} · {level?.label} {section?.name}
              </h1>
              {sheet.is_locked ? (
                <Badge variant="secondary">
                  <Lock className="h-3 w-3" />
                  Locked
                </Badge>
              ) : (
                <Badge variant="default">Open</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {term?.label}
              {sheet.teacher_name && (
                <span className="ml-2">· {sheet.teacher_name}</span>
              )}
            </p>
          </div>
          {canManage && <LockToggle sheetId={sheet.id} isLocked={sheet.is_locked} />}
        </div>
      </header>

      {sheet.is_locked && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>
            {readOnly
              ? 'This sheet is locked. Contact the registrar to request corrections.'
              : 'This sheet is locked. Any edit you make will be written to the audit log and requires an approval reference.'}
            {canManage && (
              <>
                {' '}
                <Link
                  href={`/admin/audit-log?sheet_id=${sheet.id}`}
                  className="font-medium underline underline-offset-2"
                >
                  View audit log →
                </Link>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {canManage && subject?.is_examinable !== false && (
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

      {subject?.is_examinable === false ? (
        <LetterGradeGrid
          sheetId={sheet.id}
          rows={rows}
          readOnly={readOnly}
          requireApproval={requireApproval}
        />
      ) : (
        <ScoreEntryGrid
          sheetId={sheet.id}
          wwTotals={(sheet.ww_totals ?? []) as number[]}
          ptTotals={(sheet.pt_totals ?? []) as number[]}
          qaTotal={sheet.qa_total as number | null}
          weights={{
            ww: Number(config?.ww_weight ?? 0),
            pt: Number(config?.pt_weight ?? 0),
            qa: Number(config?.qa_weight ?? 0),
          }}
          rows={rows}
          readOnly={readOnly}
          requireApproval={requireApproval}
        />
      )}
    </PageShell>
  );
}
