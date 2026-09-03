import {
  AlertTriangle,
  ArrowLeft,
  GraduationCap,
  Layers,
  LayoutGrid,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EvaluationSectionsList } from '@/components/evaluation/sections-list';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getWriteupProgressByTerm,
  listFormAdviserSectionIds,
} from '@/lib/evaluation/queries';
import { deriveTermShortLabels } from '@/lib/evaluation/term-short-labels';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import { getSessionUser } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

// Phase 9 (design doc 2026-07-28-classroom-workspace-design.md, phase-9-brief.md):
// this page is a plain, term-agnostic section list — consistent with
// Attendance's /attendance/sections and Markbook's /markbook/sections. The
// term picker belongs on the class's own page (Classroom's Write-ups tab /
// /evaluation/sections/[sectionId], which keeps its own term switcher), not
// before you've picked a class.
export default async function EvaluationSectionsPickerPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  // A role allowlist that redirects — it decides whether the viewer may be
  // here at all.
  if (
    sessionUser.role !== 'teacher' &&
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  // Everything BELOW this line is a rendering decision — which sections to
  // list, what to call them, whether to print the adviser column.
  const view = sessionUser.role;

  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  // T1–T3 only; T4 excluded (no FCA comment on the final card, KD #49). Kept
  // solely to power the virtue-theme warning below — the term picker itself
  // moved to the section detail page.
  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, virtue_theme')
    .eq('academic_year_id', ay.id)
    .neq('term_number', 4)
    .order('term_number', { ascending: true });

  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    virtue_theme: string | null;
  };
  const terms = (termsRaw ?? []) as TermRow[];
  // Virtue theme is a hard publish gate (KD #138) — a missing one on any
  // displayed term silently blocks that term's report cards, so the warning
  // now checks every T1–T3 term rather than only the previously-selected one.
  const missingVirtueTerms = terms.filter((t) => !t.virtue_theme);
  const shortTermLabels = deriveTermShortLabels(terms);

  const { data: allSections } = await supabase
    .from('sections')
    .select('id, name, level:levels(id, code, label, level_type)')
    .eq('academic_year_id', ay.id);

  let sections: Array<{ id: string; name: string; level: LevelLite | null }> = (
    (allSections ?? []) as Array<{
      id: string;
      name: string;
      level: LevelLite | LevelLite[] | null;
    }>
  ).map((s) => ({
    id: s.id,
    name: s.name,
    level: Array.isArray(s.level) ? (s.level[0] ?? null) : s.level,
  }));

  // Teachers see only their advisory sections — subject teachers have no
  // role in this module after the purpose fix.
  //
  // ⚠ ON THE LENS. `listFormAdviserSectionIds` reads this viewer's OWN adviser
  // rows, so a teaching admin in the Teacher view gets her own classes and
  // nothing else — a strict subset of the school-wide list she keeps in the
  // Admin view. The section detail page narrows the same way, so a row on this
  // list can no longer point at a page that turns her away.
  if (view === 'teacher') {
    const adviserSet = await listFormAdviserSectionIds(sessionUser.id);
    sections = sections.filter((s) => adviserSet.has(s.id));
  }

  const sectionIds = sections.map((s) => s.id);

  // Advisers are only relevant for registrar+ (teachers already know they're
  // the adviser for their own sections — surfacing it is noise). On the lens,
  // so the column follows the list it labels rather than the account.
  const adviserMap =
    view !== 'teacher'
      ? await loadFormAdvisersBySection(sectionIds, ay.ay_code)
      : ({} as Record<string, { userId: string; name: string }>);

  // Active-roster count per section — the same non-term-scoped read
  // Attendance's and Markbook's section lists already use for their "Active
  // students" card, kept for consistency now that this list is term-agnostic.
  const activeCounts: Record<string, number> = {};
  if (sectionIds.length > 0) {
    const { data: enrolments } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status')
      .in('section_id', sectionIds);
    for (const row of enrolments ?? []) {
      if (row.enrollment_status !== 'withdrawn') {
        activeCounts[row.section_id] = (activeCounts[row.section_id] ?? 0) + 1;
      }
    }
  }

  // Per-term write-up progress — one column per AY term (Phase 10). Reuses
  // the existing, tested getWriteupProgressByTerm (KD #120/#126: submitted +
  // non-empty, credited via the live roster by student_id so a mid-year
  // transfer isn't mis-attributed, KD #67) — one call per term inside a
  // single Promise.all, no new batched query.
  const progressPerTerm = await Promise.all(
    terms.map((t) => getWriteupProgressByTerm(t.id, sectionIds))
  );
  const writeupProgressBySection: Record<
    string,
    Record<string, { submitted: number; active: number }>
  > = {};
  for (const sectionId of sectionIds) writeupProgressBySection[sectionId] = {};
  terms.forEach((t, i) => {
    const bySection = progressPerTerm[i];
    for (const sectionId of sectionIds) {
      const p = bySection[sectionId];
      writeupProgressBySection[sectionId][t.id] = {
        submitted: p?.submitted_count ?? 0,
        active: p?.active_count ?? 0,
      };
    }
  });
  const termColumns = terms.map((t) => ({
    id: t.id,
    label: t.label,
    shortLabel: shortTermLabels[t.id],
  }));

  const sorted = sections.slice().sort((a, b) => {
    const ca = a.level?.code ?? '';
    const cb = b.level?.code ?? '';
    return ca.localeCompare(cb) || a.name.localeCompare(b.name);
  });

  // ✅ NOW SCOPED ON THE LENS (role-switcher Phase 3c) — the heading, the empty
  // state, the KPI label, the virtue-theme sentence and the row destination all
  // follow the same flag the section filter above uses, so the page cannot say
  // "Sections." over a list that holds only hers.
  //
  // The comment that used to sit here claimed the row destination came from
  // "the shared classroom scope resolver" so it could not drift from
  // Classroom. It did not: `resolveClassroomScope` was imported and never
  // called, and `isTeacher` (plus the `listFormAdviserSectionIds` filter
  // further up) decides everything. Import and claim both removed.
  const isTeacher = view === 'teacher';

  const levels = Array.from(
    new Map(
      sorted
        .filter((s) => s.level?.id)
        .map((s) => [
          s.level!.id,
          { id: s.level!.id, code: s.level!.code, label: s.level!.label },
        ])
    ).values()
  );

  const totalActive = Object.values(activeCounts).reduce((n, c) => n + c, 0);
  const levelCount = new Set(sorted.map((s) => s.level?.label).filter(Boolean))
    .size;

  return (
    <PageShell>
      <Link
        href="/evaluation"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Evaluation
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {ay.ay_code}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {isTeacher ? 'Your sections.' : 'Sections.'}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {isTeacher
              ? 'Your advisory sections. Open one to write student evaluations.'
              : 'Every section in the current academic year. Pick one to view or edit evaluations.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {ay.ay_code}
          </Badge>
        </div>
      </header>

      {missingVirtueTerms.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-amber/15 text-brand-amber">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-serif text-sm font-semibold text-foreground">
              {missingVirtueTerms.length === 1
                ? `Virtue theme not set for ${missingVirtueTerms[0].label}.`
                : `Virtue themes not set for ${missingVirtueTerms
                    .map((t) => t.label)
                    .join(', ')}.`}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The academic coordinator sets the virtue theme in{' '}
              <Link
                href="/evaluation/virtue-themes"
                className="font-medium text-brand-amber underline underline-offset-2"
              >
                Evaluation → Virtue themes
              </Link>
              . Until it&apos;s set for a term,{' '}
              {isTeacher
                ? "that term's write-up fields are locked."
                : "advisers can't start writing for that term (academic coordinators can still edit if needed)."}
            </p>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs">
            <SummaryCard
              description={isTeacher ? 'Your sections' : 'Total sections'}
              value={sorted.length.toLocaleString('en-SG')}
              icon={Layers}
              footerTitle={`${levelCount} ${levelCount === 1 ? 'level' : 'levels'}`}
              footerDetail={ay.label}
            />
            <SummaryCard
              description="Active students"
              value={totalActive.toLocaleString('en-SG')}
              icon={Users}
              footerTitle="Currently enrolled"
              footerDetail="Across every section listed"
            />
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo/10 to-brand-indigo/5">
              <GraduationCap className="size-6 text-brand-indigo/60" />
            </div>
            <p className="font-serif text-lg font-semibold text-foreground">
              {isTeacher ? 'No advisory sections.' : 'No sections in this AY.'}
            </p>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {isTeacher
                ? 'You have no form adviser assignments. Ask the academic coordinator to assign one in SIS Admin → Sections.'
                : 'Create sections in SIS Admin → Sections for the current academic year.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <div className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <LayoutGrid className="size-3" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {sorted.length} {sorted.length === 1 ? 'section' : 'sections'}
            </p>
          </div>

          <EvaluationSectionsList
            levels={levels}
            terms={termColumns}
            isTeacher={isTeacher}
            sections={sorted.map((s) => ({
              id: s.id,
              name: s.name,
              levelId: s.level?.id ?? null,
              levelLabel: s.level?.label ?? null,
              fcaName: adviserMap[s.id]?.name ?? null,
              writeupProgress: writeupProgressBySection[s.id] ?? {},
            }))}
          />
        </>
      )}
    </PageShell>
  );
}

function SummaryCard({
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
