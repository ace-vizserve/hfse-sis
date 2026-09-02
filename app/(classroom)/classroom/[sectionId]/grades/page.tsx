import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, BookOpen, CheckCircle2, Lock } from 'lucide-react';

import { AtRiskLookup } from '@/components/classroom/at-risk-lookup';
import { Badge } from '@/components/ui/badge';
import { subjectTeacherPairs } from '@/lib/auth/teacher-assignments';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadReportCard } from '@/lib/classroom/scope';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { getViewContext } from '@/lib/auth/view-context';
import { createClient } from '@/lib/supabase/server';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

type SubjectLite = { id: string; code: string; name: string };
type SheetRow = {
  id: string;
  is_locked: boolean;
  subject: SubjectLite | SubjectLite[] | null;
  /**
   * The sheet's own subject_configs row — per (subject, academic year), so
   * this is where the name the school used THIS year lives (migration 137).
   * Reaching it costs nothing: every grading sheet already points at one via
   * subject_config_id.
   */
  subject_config:
    | { display_name: string | null }
    | { display_name: string | null }[]
    | null;
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

  // `activeRole`, not `role` — a page renders through the lens. See the
  // section layout for the full note.
  const view = await getViewContext();
  if (!view) redirect('/login');
  const { id: userId, activeRole } = view;

  const { capability, substantiveCapability, assignments } =
    await loadClassroomAccess(activeRole, userId, sectionId);
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
      .select(
        'id, is_locked, subject:subjects(id, code, name), subject_config:subject_configs(display_name)'
      )
      .eq('section_id', sectionId)
      .eq('term_id', selectedTermId);
    sheets = (data ?? []) as unknown as SheetRow[];
  }

  const subjectOf = (s: SheetRow) =>
    Array.isArray(s.subject) ? s.subject[0] : s.subject;
  // See SheetRow — this is where the per-year name comes from.
  const configOf = (s: SheetRow) =>
    Array.isArray(s.subject_config) ? s.subject_config[0] : s.subject_config;

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
        <div className="flex items-center gap-3">
          {/* Adviser + oversight only, the same bar as the report card and for
              the same reason: this carries every subject's marks for the whole
              class, which a subject teacher has no business seeing. Their half
              of Ms Koh's ask is the lookup on their own grading sheet
              (KD #179). Hidden entirely in Term 1 — there is no earlier term to
              have fallen from, so the button would open onto a permanent
              nothing. */}
          {/* substantiveCapability: the at-risk panel and report-card link are
              the adviser's own pastoral work, kept with them during cover. */}
          {selectedTerm &&
            selectedTermId &&
            canReadReportCard(substantiveCapability) && (
              <AtRiskLookup
                sectionId={sectionId}
                termId={selectedTermId}
                termLabel={selectedTerm.label}
              />
            )}
          {selectedTerm && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {selectedTerm.label}
            </span>
          )}
        </div>
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
                      {subj
                        ? subjectDisplayName(subj, configOf(s))
                        : 'Unknown subject'}
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
