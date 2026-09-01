import { ArrowLeft, Sparkle } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TermSwitcher } from '@/components/evaluation/term-switcher';
import { WriteupRosterClient } from '@/components/evaluation/writeup-roster-client';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import {
  getEvaluationTermConfig,
  getSectionRoster,
  listFormAdviserSectionIds,
} from '@/lib/evaluation/queries';
import { hasWriteupContent } from '@/lib/evaluation/roster-rules';
import { createClient, getSessionUser } from '@/lib/supabase/server';

export default async function EvaluationSectionRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'teacher' &&
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { sectionId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select(
      'id, name, academic_year_id, level:levels(id, label, level_type), academic_year:academic_years(id, ay_code, label)'
    )
    .eq('id', sectionId)
    .single();
  if (!section) notFound();

  // Teachers must be the section's form adviser — subject teachers have no
  // role in this module after the purpose fix (KD evaluation purpose spec).
  if (sessionUser.role === 'teacher') {
    const adviserSet = await listFormAdviserSectionIds(sessionUser.id);
    if (!adviserSet.has(sectionId)) redirect('/evaluation/sections');
  }

  // T1–T3 only; T4 excluded (no FCA comment on the final card, KD #49).
  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .neq('term_number', 4)
    .order('term_number', { ascending: true });

  type TermLite = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
  };
  const terms = (termsRaw ?? []) as TermLite[];
  const defaultTermId =
    sp.term_id ?? terms.find((t) => t.is_current)?.id ?? terms[0]?.id ?? '';
  const selectedTerm = terms.find((t) => t.id === defaultTermId) ?? null;
  if (!selectedTerm) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No T1–T3 term configured for this AY.
        </div>
      </PageShell>
    );
  }

  const [config, roster] = await Promise.all([
    getEvaluationTermConfig(selectedTerm.id),
    getSectionRoster(sectionId, selectedTerm.id),
  ]);

  const level = (
    Array.isArray(section.level) ? section.level[0] : section.level
  ) as { id: string; label: string; level_type: string } | null;
  const ay = (
    Array.isArray(section.academic_year)
      ? section.academic_year[0]
      : section.academic_year
  ) as { ay_code: string; label: string } | null;

  // Teachers are locked until Joann sets the virtue theme; registrar+ can
  // always edit (write-up fields gate per canEdit in WriteupRosterClient).
  const canEdit = sessionUser.role !== 'teacher' || !!config?.virtueTheme;
  // Submitted AND non-empty — an emptied write-up is "missing", not submitted
  // (keeps the count consistent with the sections list + publish-readiness).
  // Emptiness comes from the shared KD #120 helper: the column holds formatted
  // text, so a submitted-but-never-typed-in write-up is `<p></p>`, which the
  // `.trim().length > 0` test this replaces counted as written.
  const submittedCount = roster.filter(
    (r) => r.submitted && hasWriteupContent(r.writeup)
  ).length;
  const totalCount = roster.length;

  return (
    <PageShell>
      <Link
        href="/evaluation/sections"
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
            {submittedCount} of {totalCount} write-ups submitted. Autosaves per
            keystroke; Submit stamps a write-up as finalised (edits stay
            possible).
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Term
          </span>
          <TermSwitcher current={defaultTermId} options={terms} />
        </div>
      </header>

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
            &ldquo;Form Class Adviser&rsquo;s Comments (HFSE Virtues:{' '}
            {config.virtueTheme})&rdquo; on the {selectedTerm.label} report
            card.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">
            Virtue theme not set for {selectedTerm.label}.
          </p>
          <p className="mt-1 text-amber-800/80 dark:text-amber-200/80">
            {sessionUser.role === 'teacher' ? (
              <>
                Write-up fields are locked until the academic coordinator sets
                the theme in SIS Admin.
              </>
            ) : (
              <>
                Set it in{' '}
                <Link
                  href="/evaluation/virtue-themes"
                  className="font-medium underline underline-offset-2"
                >
                  Evaluation → Virtue themes
                </Link>
                . Editing stays possible for academic coordinators and above in
                the meantime.
              </>
            )}
          </p>
        </div>
      )}

      {/* key on the term so a term switch remounts the client and re-seeds its
          local row state from the new term's roster — without it, the textareas
          keep showing the prior term's write-ups until a hard reload (the
          client seeds rows via a mount-only useState initializer). Same-term
          refresh keeps the key, so saving a draft doesn't lose focus/scroll. */}
      <WriteupRosterClient
        key={selectedTerm.id}
        termId={selectedTerm.id}
        sectionId={section.id}
        roster={roster}
        canEdit={canEdit}
      />
    </PageShell>
  );
}
