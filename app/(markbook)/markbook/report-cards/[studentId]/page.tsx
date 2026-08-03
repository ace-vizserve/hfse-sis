import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadReportCard } from '@/lib/classroom/scope';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTerm } from '@/lib/sis/current-term';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { PublicationStatus } from '@/components/admin/publication-status';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PrintButton } from './print-button';

export default async function ReportCardPreview({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { studentId } = await params;
  const { term: termParam } = await searchParams;
  const [supabase, sessionUser] = await Promise.all([
    createClient(),
    getSessionUser(),
  ]);
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;
  const canManage =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';

  const result = await buildReportCard(supabase, studentId);
  if (!result.ok) {
    // These two diagnostic states are for the people who can act on them.
    // Returning them to anyone who passes the broad `/markbook` prefix would
    // make this page an existence oracle: a probed uuid could be told apart as
    // "real student, not enrolled this AY" versus "no such student", before the
    // capability check below ever runs. Everyone else just gets a 404.
    if (canManage && result.error.kind === 'no_current_ay') {
      return <div className="text-destructive">No current academic year.</div>;
    }
    if (canManage && result.error.kind === 'not_enrolled_this_ay') {
      return (
        <div className="text-sm text-muted-foreground">
          Student is not enrolled in the current academic year (
          {result.error.ayLabel}).
        </div>
      );
    }
    notFound();
  }
  const payload = result.payload;

  // Section-level gate. `ROUTE_ACCESS` only covers the broad `/markbook`
  // prefix, which admits every teacher, and this page previously had NO role
  // check of its own — the only report-card page without one. A form adviser
  // needs the card (they write the comment on it); a subject teacher gets a
  // structurally hollow document (see canReadReportCard), so they get 404.
  //
  // Runs after buildReportCard because the section is only known from the
  // payload's primary enrolment — which is also the right section to gate on
  // for a mid-year transfer: access follows the student's CURRENT adviser.
  const { capability } = await loadClassroomAccess(
    role,
    sessionUser.id,
    payload.section.id
  );
  if (!canReadReportCard(capability)) notFound();

  // Which term to view: the URL param wins; otherwise the canonical resolver
  // (KD #116) decides. It used to read `.eq('is_current', true)` and fall back
  // to `?? 1` — but `terms.is_current` is a manually-set flag that is routinely
  // left unset, so the fallback pinned the card to Term 1 and the document
  // (which renders comment boxes for terms 1..viewingTermNumber) dropped every
  // T2 and T3 form-adviser comment. AY-scoped so a stale flag on a past-AY term
  // can't leak in.
  //
  // This queries rather than reusing `payload.terms` (which already carries
  // start_date/end_date) on purpose: the payload's Term has no `is_current`,
  // and that is the resolver's layer-2 manual override — the one a coordinator
  // sets to steer the default during a between-terms gap. Reusing the payload
  // would silently drop it.
  const { data: ayTerms } = await supabase
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current')
    .eq('academic_year_id', payload.ay.id);
  const parsedTerm = termParam ? parseInt(termParam, 10) : NaN;
  const resolvedTerm = resolveCurrentTerm(ayTerms ?? [], sgToday());
  const viewingTermNumber = (
    [1, 2, 3, 4].includes(parsedTerm)
      ? parsedTerm
      : (resolvedTerm?.term_number ?? 1)
  ) as 1 | 2 | 3 | 4;

  // Already ordered by term_number from the builder's query.
  const termOptions = payload.terms;

  return (
    <div className="space-y-6">
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6 print:hidden">
        {/* The report-cards index is coordinator-and-above, so sending a form
            adviser there would dead-end them in a 404. They came from their
            class, so that is where back goes. */}
        <Link
          href={
            canManage
              ? '/markbook/report-cards'
              : `/classroom/${payload.section.id}/students`
          }
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {canManage ? 'All report cards' : `Back to ${payload.section.name}`}
        </Link>

        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Report card · {payload.ay.label}
            </p>
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {payload.student.full_name}.
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {payload.level.label} · {payload.section.name}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton />
          </div>
        </header>

        {/* Term selector. One pill per term, each carrying its own ?term=N.
            This replaced a two-pill Interim/Final pair whose "Interim (T1–T3)"
            trigger hardcoded `?term=1` — it rendered highlighted for T1–T3, so
            it read as a no-op, and clicking it collapsed three comment boxes to
            one. The card is cumulative, so the control names the term you are
            viewing as of, never a template. §8 URL-driven Tabs pattern. */}
        <div className="space-y-2">
          <Tabs value={String(viewingTermNumber)}>
            {/* The label goes on TabsList — that's the element carrying
                role="tablist"; on the Root div it has nothing to name. */}
            <TabsList aria-label="Report card term">
              {termOptions.map((t) => (
                <TabsTrigger key={t.id} value={String(t.term_number)} asChild>
                  <Link
                    href={`/markbook/report-cards/${studentId}?term=${t.term_number}`}
                  >
                    {t.term_number === 4 ? 'Final' : t.label}
                  </Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {/* Christina asked at the 2026-07-31 training whether the system
              could show a whole year at once. It already does — `visibleTerms`
              in report-card-document.tsx renders Terms 1-3 side by side at any
              interim term, and all four at Final. The previous wording ("every
              term up to the one selected") described the COMMENTS, which are
              cumulative, and read as though the grades table hid earlier
              terms. Nobody had reason to look. */}
          <p className="text-xs text-muted-foreground">
            Grades for Terms 1&ndash;3 always appear together; Final adds Term 4
            and the year&rsquo;s overall result. Choosing a term changes which
            adviser comments are shown.
          </p>
        </div>

        {/* Coordinator-and-above only. It reads `report_card_publications`
            through the cookie client, and that table's RLS is
            `is_registrar_or_above()` — so for a form adviser it returns zero
            rows and states the FALSE "No terms are currently visible to
            parents", above a Manage link that 404s for them. */}
        {canManage && (
          <PublicationStatus
            sectionId={payload.section.id}
            terms={payload.terms}
          />
        )}
      </div>

      {/* This is the working preview, so it shows an unsubmitted write-up
          flagged as a draft. The batch print and the parent API leave
          `showDrafts` off — a draft must never reach a deliverable. */}
      <ReportCardDocument
        payload={payload}
        viewingTermNumber={viewingTermNumber}
        canManage={canManage}
        showDrafts
      />
    </div>
  );
}
