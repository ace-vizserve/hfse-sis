import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, BookOpen, CheckCircle2, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { subjectTeacherPairs } from '@/lib/auth/teacher-assignments';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { createClient, getSessionUser } from '@/lib/supabase/server';

type SubjectLite = { id: string; code: string; name: string };
type SheetRow = {
  id: string;
  is_locked: boolean;
  subject: SubjectLite | SubjectLite[] | null;
};

// Grades — the grading sheets for this (section, term). One sheet per
// (term_id, section_id, subject_id). A subject-teacher-only viewer sees only
// their own subjects' sheets, narrowed via the existing subjectTeacherPairs
// helper (never a bespoke filter) — the DB-level RLS predicate this mirrors
// is `is_teacher_for_sheet` (see lib/classroom/scope.ts).
export default async function ClassroomGradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  const { capability, assignments } = await loadClassroomAccess(
    role,
    userId,
    sectionId
  );
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();

  const terms = await getTermsForAy(section.academic_year_id);
  const selectedTermId = resolveSelectedTermId(terms, sp.term_id);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

  let sheets: SheetRow[] = [];
  if (selectedTermId) {
    const { data } = await supabase
      .from('grading_sheets')
      .select('id, is_locked, subject:subjects(id, code, name)')
      .eq('section_id', sectionId)
      .eq('term_id', selectedTermId);
    sheets = (data ?? []) as unknown as SheetRow[];
  }

  const subjectOf = (s: SheetRow) =>
    Array.isArray(s.subject) ? s.subject[0] : s.subject;

  if (capability === 'subject') {
    const mySubjectIds = new Set(
      subjectTeacherPairs(assignments)
        .filter((p) => p.section_id === sectionId)
        .map((p) => p.subject_id)
    );
    sheets = sheets.filter((s) => {
      const subj = subjectOf(s);
      return subj != null && mySubjectIds.has(subj.id);
    });
  }

  sheets.sort((a, b) =>
    (subjectOf(a)?.name ?? '').localeCompare(subjectOf(b)?.name ?? '')
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading sheets
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
            {sheets.length}
          </span>
        </h2>
        {selectedTerm && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {selectedTerm.label}
          </span>
        )}
      </div>

      {!selectedTermId ? (
        <EmptyPanel text="No term configured for this academic year." />
      ) : sheets.length === 0 ? (
        <EmptyPanel text="No grading sheets for this term yet." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {sheets.map((s) => {
            const subj = subjectOf(s);
            return (
              <Link
                key={s.id}
                href={`/markbook/grading/${s.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <BookOpen className="size-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {subj?.name ?? 'Unknown subject'}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      {subj?.code ?? '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {s.is_locked ? (
                    <Badge variant="blocked" className="gap-1">
                      <Lock className="h-3 w-3" />
                      Locked
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Open
                    </Badge>
                  )}
                  <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
