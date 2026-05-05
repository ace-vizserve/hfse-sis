import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ClipboardList, MessageCircle, Sparkle, SquarePen } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WriteupRosterClient } from '@/components/evaluation/writeup-roster-client';
import { ChecklistRosterClient } from '@/components/evaluation/checklist-roster-client';
import { PtcRosterClient } from '@/components/evaluation/ptc-roster-client';
import {
  getEvaluationTermConfig,
  getSectionRoster,
  listFormAdviserSectionIds,
} from '@/lib/evaluation/queries';
import {
  getPtcFeedbackBySectionTerm,
  getResponsesBySectionTerm,
  getSubjectCommentsBySectionTerm,
  listChecklistItems,
  listTeacherSubjectsForSection,
} from '@/lib/evaluation/checklist';

export default async function EvaluationSectionRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string; tab?: string; subject_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'teacher' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { sectionId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  // Section + level + AY.
  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, academic_year_id, level:levels(id, label, level_type), academic_year:academic_years(id, ay_code, label)',
    )
    .eq('id', sectionId)
    .single();
  if (!section) notFound();

  // Teacher access gate: must be form_adviser OR subject_teacher on this
  // section. Writeups tab is adviser-only; Checklists tab is open to
  // either role (subject-scoped for subject teachers).
  let teacherIsFormAdviser = false;
  let teacherSubjectIds: string[] = [];
  if (sessionUser.role === 'teacher') {
    const [adviserSet, subjects] = await Promise.all([
      listFormAdviserSectionIds(sessionUser.id),
      listTeacherSubjectsForSection(sessionUser.id, sectionId),
    ]);
    teacherIsFormAdviser = adviserSet.has(sectionId);
    teacherSubjectIds = subjects;
    if (!teacherIsFormAdviser && teacherSubjectIds.length === 0) {
      redirect('/evaluation/sections');
    }
  }

  // Terms in this AY, excluding T4 (no comment on the final card per KD #49).
  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .neq('term_number', 4)
    .order('term_number', { ascending: true });

  type TermLite = { id: string; label: string; term_number: number; is_current: boolean };
  const terms = (termsRaw ?? []) as TermLite[];
  const defaultTermId =
    sp.term_id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';
  const selectedTerm = terms.find((t) => t.id === defaultTermId) ?? null;
  if (!selectedTerm) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No T1–T3 term configured for this AY.</div>
      </PageShell>
    );
  }

  const config = await getEvaluationTermConfig(selectedTerm.id);
  const roster = await getSectionRoster(sectionId, selectedTerm.id);

  const level = (Array.isArray(section.level) ? section.level[0] : section.level) as
    | { id: string; label: string; level_type: string }
    | null;
  const ay = (Array.isArray(section.academic_year) ? section.academic_year[0] : section.academic_year) as
    | { ay_code: string; label: string }
    | null;

  const canEdit = sessionUser.role !== 'teacher' || !!config?.virtueTheme;
  const submittedCount = roster.filter((r) => r.submitted).length;
  const totalCount = roster.length;

  // Writeups tab is only available to form_adviser + registrar+.
  // Checklists tab is available to form_adviser + subject_teacher + registrar+.
  const canAccessWriteups =
    sessionUser.role !== 'teacher' || teacherIsFormAdviser;
  const canAccessChecklists =
    sessionUser.role !== 'teacher' ||
    teacherIsFormAdviser ||
    teacherSubjectIds.length > 0;

  // Load the level's subjects so the Checklists tab has a subject picker.
  // Teachers with subject assignments see only their subjects; form_adviser
  // + registrar+ see all subjects enabled for this level × AY.
  const { data: configRows } = level
    ? await supabase
        .from('subject_configs')
        .select('subject:subjects(id, code, name)')
        .eq('academic_year_id', section.academic_year_id)
        .eq('level_id', level.id)
    : { data: [] };
  type CfgRow = {
    subject:
      | { id: string; code: string; name: string }
      | { id: string; code: string; name: string }[]
      | null;
  };
  const levelSubjects = ((configRows ?? []) as CfgRow[])
    .map((c) => (Array.isArray(c.subject) ? c.subject[0] : c.subject))
    .filter((s): s is { id: string; code: string; name: string } => !!s)
    .sort((a, b) => a.name.localeCompare(b.name));

  const visibleSubjects =
    sessionUser.role === 'teacher' && !teacherIsFormAdviser
      ? levelSubjects.filter((s) => teacherSubjectIds.includes(s.id))
      : levelSubjects;

  const selectedSubjectId =
    sp.subject_id && visibleSubjects.some((s) => s.id === sp.subject_id)
      ? sp.subject_id
      : visibleSubjects[0]?.id ?? '';

  // Fetch checklist data for the selected subject. Cheap — a section has
  // ~10 students × ~10 items = ~100 responses tops.
  const [items, responseMap, commentMap] = selectedSubjectId && level
    ? await Promise.all([
        listChecklistItems(selectedTerm.id, selectedSubjectId, level.id),
        getResponsesBySectionTerm(sectionId, selectedTerm.id),
        getSubjectCommentsBySectionTerm(sectionId, selectedTerm.id, selectedSubjectId),
      ])
    : [[], new Map(), new Map()];

  const responsesForClient = new Map<string, boolean>();
  for (const [k, row] of responseMap.entries()) {
    responsesForClient.set(k, row.is_checked);
  }
  const commentsForClient = new Map<string, string>();
  for (const [studentId, row] of commentMap.entries()) {
    commentsForClient.set(studentId, row.comment ?? '');
  }

  // PTC feedback is registrar+ only; teachers don't see the tab.
  const canAccessPtc =
    sessionUser.role === 'registrar' ||
    sessionUser.role === 'school_admin' ||
    sessionUser.role === 'superadmin';
  const ptcMap = canAccessPtc
    ? await getPtcFeedbackBySectionTerm(sectionId, selectedTerm.id)
    : new Map();
  const ptcForClient = new Map<string, string>();
  for (const [studentId, row] of ptcMap.entries()) {
    ptcForClient.set(studentId, row.feedback ?? '');
  }

  const initialTab =
    sp.tab === 'checklists' && canAccessChecklists
      ? 'checklists'
      : sp.tab === 'ptc' && canAccessPtc
        ? 'ptc'
        : canAccessWriteups
          ? 'writeups'
          : canAccessChecklists
            ? 'checklists'
            : 'ptc';

  return (
    <PageShell>
      <Link
        href={`/evaluation/sections?term_id=${selectedTerm.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sections
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Evaluation · Write-ups
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {section.name}
            </h1>
            {level && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {level.label}
              </Badge>
            )}
            {ay && (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
              >
                {ay.ay_code}
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {submittedCount} of {totalCount} write-ups submitted. Autosaves per keystroke; Submit
            stamps a write-up as finalised (edits stay possible).
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <form action="" className="flex items-center gap-2">
            <label
              htmlFor="term-picker"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Term
            </label>
            <select
              id="term-picker"
              name="term_id"
              defaultValue={defaultTermId}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} {t.is_current ? '(current)' : ''}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm font-medium hover:border-primary/30"
            >
              Go
            </button>
          </form>
        </div>
      </header>

      {/* Virtue theme banner */}
      {config?.virtueTheme ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <Sparkle className="size-4 text-primary" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Virtue theme · {selectedTerm.label}
            </span>
          </div>
          <p className="mt-1 font-serif text-lg font-semibold tracking-tight text-foreground">
            {config.virtueTheme}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Write about each student through the lens of this theme. Appears as
            &ldquo;Form Class Adviser&rsquo;s Comments (HFSE Virtues: {config.virtueTheme})&rdquo;
            on the {selectedTerm.label} report card.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">Virtue theme not set for {selectedTerm.label}.</p>
          <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
            {sessionUser.role === 'teacher' ? (
              <>Write-up fields are locked until Joann sets the theme in SIS Admin.</>
            ) : (
              <>
                Set it in{' '}
                <Link href="/sis/ay-setup" className="font-medium underline underline-offset-2">
                  SIS Admin → AY Setup → Dates
                </Link>
                . Editing stays possible for registrar+ in the meantime.
              </>
            )}
          </p>
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        <TabsList>
          {canAccessWriteups && (
            <TabsTrigger value="writeups">
              <SquarePen className="h-3.5 w-3.5" />
              Write-ups
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {submittedCount}/{totalCount}
              </span>
            </TabsTrigger>
          )}
          {canAccessChecklists && (
            <TabsTrigger value="checklists">
              <ClipboardList className="h-3.5 w-3.5" />
              Checklists
            </TabsTrigger>
          )}
          {canAccessPtc && (
            <TabsTrigger value="ptc">
              <MessageCircle className="h-3.5 w-3.5" />
              PTC
            </TabsTrigger>
          )}
        </TabsList>

        {canAccessWriteups && (
          <TabsContent value="writeups" className="mt-4">
            <WriteupRosterClient
              termId={selectedTerm.id}
              sectionId={section.id}
              roster={roster}
              canEdit={canEdit}
            />
          </TabsContent>
        )}

        {canAccessChecklists && (
          <TabsContent value="checklists" className="mt-4">
            {visibleSubjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                No subjects enabled for this level × AY. Configure via{' '}
                <span className="whitespace-nowrap font-mono text-[11px]">
                  SIS Admin → Subject Weights
                </span>
                .
              </div>
            ) : (
              <ChecklistRosterClient
                termId={selectedTerm.id}
                sectionId={section.id}
                subjects={visibleSubjects}
                initialSubjectId={selectedSubjectId}
                items={items.map((i) => ({
                  id: i.id,
                  item_text: i.item_text,
                  sort_order: i.sort_order,
                }))}
                roster={roster.map((r) => ({
                  section_student_id: r.section_student_id,
                  student_id: r.student_id,
                  index_number: r.index_number,
                  student_number: r.student_number,
                  student_name: r.student_name,
                }))}
                initialResponses={responsesForClient}
                initialComments={commentsForClient}
                canEdit={canEdit}
              />
            )}
          </TabsContent>
        )}

        {canAccessPtc && (
          <TabsContent value="ptc" className="mt-4">
            <PtcRosterClient
              termId={selectedTerm.id}
              sectionId={section.id}
              roster={roster.map((r) => ({
                student_id: r.student_id,
                index_number: r.index_number,
                student_number: r.student_number,
                student_name: r.student_name,
              }))}
              initialFeedback={ptcForClient}
            />
          </TabsContent>
        )}
      </Tabs>
    </PageShell>
  );
}
