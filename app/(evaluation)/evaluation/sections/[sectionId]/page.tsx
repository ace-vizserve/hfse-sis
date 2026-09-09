import { ArrowLeft, BookOpenCheck, Sparkle } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TermSwitcher } from '@/components/evaluation/term-switcher';
import { WriteupRosterClient } from '@/components/evaluation/writeup-roster-client';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { listAdviserOfRecordSectionIds } from '@/lib/evaluation/adviser-of-record';
import { canEditWriteups } from '@/lib/evaluation/edit-gate';
import {
  getEvaluationTermConfig,
  getSectionRoster,
  listAdvisedSectionIds,
} from '@/lib/evaluation/queries';
import { hasWriteupContent } from '@/lib/evaluation/roster-rules';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';
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

  const role = sessionUser.role;

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

  // Teachers must advise the section — subject teachers have no role in this
  // module after the purpose fix (KD evaluation purpose spec).
  //
  // TWO QUESTIONS, and they have different answers for a co-adviser. Advising
  // the class at all decides whether the page opens; being the adviser OF
  // RECORD decides whether the write-up fields accept typing. A co-adviser
  // reads what the form class adviser wrote about children they co-advise, and
  // writes nothing — the write-up is the comment that prints on the report
  // card under one name (Mr Ace, 2026-09-09).
  let isAdviserOfRecord = true;
  if (role === 'teacher') {
    const [advisedSet, ofRecordSet] = await Promise.all([
      listAdvisedSectionIds(sessionUser.id),
      listAdviserOfRecordSectionIds(sessionUser.id),
    ]);
    if (!advisedSet.has(sectionId)) {
      redirect('/evaluation/sections');
    }
    isAdviserOfRecord = ofRecordSet.has(sectionId);
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

  // Only for the co-adviser notice below — "these are not yours to write" is
  // half an answer without "and here is whose they are". One extra query, on
  // the one screen that has something to say with it.
  const adviserOfRecordName =
    !isAdviserOfRecord && ay
      ? ((await loadFormAdvisersBySection([sectionId], ay.ay_code))[sectionId]
          ?.name ?? null)
      : null;

  // Teachers are locked until Joann sets the virtue theme; registrar+ can
  // always edit (write-up fields gate per canEdit in WriteupRosterClient).
  //
  // ⚠ ON THE LENS, AND THE DIRECTION MATTERS — one of the three page↔route
  // pairs Phase 3c had to verify. The rule and the reasoning both moved into
  // `lib/evaluation/edit-gate.ts` so a test can call them; the short version is
  // that the route has no virtue-theme condition at all, so this page has
  // always refused MORE than the route and lensing makes it refuse more again.
  const canEdit = canEditWriteups(
    role,
    !!config?.virtueTheme,
    isAdviserOfRecord
  );
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
            {/* On the lens, so the sentence matches what `canEdit` above
                actually did to the fields on this screen.

                ⚠ AND ON WHO IS READING. For a co-adviser the theme is not why
                the fields are locked and never will be — setting it changes
                nothing for them. Claiming otherwise sends them to ask the
                academic coordinator for something that would not help. The
                panel above already gave them the real reason, so this one drops
                the promise and just reports the gap. */}
            {role === 'teacher' && isAdviserOfRecord ? (
              <>
                Write-up fields are locked until the academic coordinator sets
                the theme in SIS Admin.
              </>
            ) : role === 'teacher' ? (
              <>The academic coordinator has not set it yet.</>
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

      {/* Co-adviser. §9.4 status panel, accent family and a flat tile: nothing
          has gone wrong and there is nothing for them to resolve, so it is not
          destructive — but it is a standing condition rather than a step, which
          is what keeps the tile flat rather than the §7.4 gradient.

          Deliberately says what they CAN do first. A panel that only says "you
          may not" reads as a fault; the roster below it is genuinely useful to
          a co-adviser, and this sentence is what tells them to read on. */}
      {!isAdviserOfRecord && (
        <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-indigo text-white shadow-brand-tile">
            <BookOpenCheck className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              You can read these write-ups, not write them.
            </p>
            <p className="text-sm text-muted-foreground">
              You co-advise {section.name}, so the roster is yours to follow.
              The write-up becomes the form class adviser&rsquo;s comment on the
              report card, and that comment carries one name —{' '}
              {adviserOfRecordName ?? 'the form class adviser'} writes it.
            </p>
          </div>
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
