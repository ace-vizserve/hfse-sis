import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { getSessionUser, createClient } from '@/lib/supabase/server';
import {
  buildReportCard,
  type PreloadedCalendarDates,
} from '@/lib/report-card/build-report-card';
import { getEncodableDatesForTerm } from '@/lib/attendance/calendar';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTerm } from '@/lib/sis/current-term';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { PrintButton } from '../../../[studentId]/print-button';
import { AutoPrintTrigger } from './auto-print-trigger';

// Pain point #10: Joann's "batch PDF generation for the whole section in
// one action." This route renders every active + late-enrollee student in
// a section as a stacked sequence of <ReportCardDocument>s. Each card
// gets `page-break-after: always` so the browser's print dialog produces
// one multi-page job. "Save as PDF" in that dialog yields a single
// section-wide PDF — no server-side PDF service required (KD #7's
// "PDF generation deferred" stays valid; this is browser print, not
// server PDF generation).
//
// Withdrawn students are excluded — they're kept in section_students for
// audit (Hard Rule #6) but don't appear on any term's report card.
//
// URL: /markbook/report-cards/section/[sectionId]/print?term=2
// - sectionId: sections.id UUID
// - term: 1 | 2 | 3 | 4 (defaults to the current term via resolveCurrentTerm)
//
// Auth: registrar / school_admin / superadmin only — same gate as the
// section detail roster surface.

type SearchParams = Promise<{ term?: string }>;

export default async function SectionPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: SearchParams;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { sectionId } = await params;
  const { term: termParam } = await searchParams;
  const supabase = await createClient();

  // Resolve section + AY for the page header + term-default lookup.
  const { data: section } = await supabase
    .from('sections')
    .select(
      `id, name,
       academic_year:academic_years!inner(id, label, ay_code, is_current),
       level:levels!inner(id, code, label)`
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();

  const ay = Array.isArray(section.academic_year)
    ? section.academic_year[0]
    : section.academic_year;
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  // Parallelize: roster + this AY's terms are independent once ay.id is known.
  // The term list feeds BOTH the default-term resolution below and the shared
  // calendar-dates preload further down (Finding L-B/6) — it used to be two
  // queries, one of which asked only for `is_current`.
  const [{ data: enrolments }, { data: ayTerms }] = await Promise.all([
    supabase
      .from('section_students')
      .select(
        `id, index_number, enrollment_status,
         student:students!inner(id, last_name, first_name, middle_name, student_number)`
      )
      .eq('section_id', sectionId)
      .in('enrollment_status', ['active', 'late_enrollee'])
      .order('index_number'),
    supabase
      .from('terms')
      .select('id, term_number, start_date, end_date, is_current')
      .eq('academic_year_id', ay.id),
  ]);

  // Default term via the canonical resolver (KD #116), NOT `is_current` alone.
  // `terms.is_current` is a manually-set flag that is routinely left unset, and
  // the previous `?? 1` fallback then pinned EVERY card in the batch to Term 1
  // — which silently dropped every T2/T3 form-adviser comment, since the
  // document renders comment boxes for terms 1..viewingTermNumber.
  const parsedTerm = termParam ? parseInt(termParam, 10) : NaN;
  const resolvedTerm = resolveCurrentTerm(ayTerms ?? [], sgToday());
  const viewingTermNumber = (
    [1, 2, 3, 4].includes(parsedTerm)
      ? parsedTerm
      : (resolvedTerm?.term_number ?? 1)
  ) as 1 | 2 | 3 | 4;

  const studentIds: string[] = (enrolments ?? [])
    .map((e) => {
      const s = Array.isArray(e.student) ? e.student[0] : e.student;
      return s?.id;
    })
    .filter((id): id is string => typeof id === 'string');

  // Every student built below is drawn from THIS section's active roster
  // (the query above), so buildReportCard's internal primary-enrolment
  // tie-break (active/late_enrollee always outranks withdrawn) resolves
  // every one of them back to this same section — meaning they all share
  // this section's level, and therefore the same per-term encodable-date
  // set. Resolve it here ONCE so every buildReportCard call below reuses it
  // instead of each independently re-querying the same (term, levelType)
  // calendar rows (Finding L-B/6 — query-count reduction only, the resolved
  // dates are identical to what each per-student call would have fetched).
  const preloadedCalendar: PreloadedCalendarDates = {
    byTermAndLevel: new Map(),
  };
  if (studentIds.length > 0 && ayTerms && ayTerms.length > 0) {
    const levelType = levelTypeForAudienceLookup(level.code);
    await Promise.all(
      ayTerms.map(async (t) => {
        const dates = await getEncodableDatesForTerm(t.id, levelType);
        preloadedCalendar.byTermAndLevel.set(
          `${t.id}:${levelType ?? 'none'}`,
          dates
        );
      })
    );
  }

  // Build all report-card payloads in parallel. Postgres pool handles
  // 50 concurrent reads easily; serial execution was the bottleneck at
  // section size 40-50 (4-8× slower than parallel). Skip silently on
  // per-student failure — N-1 cards are better than a full-page error.
  const cards = (
    await Promise.all(
      studentIds.map(async (id) => {
        const result = await buildReportCard(supabase, id, preloadedCalendar);
        return result.ok ? { studentId: id, payload: result.payload } : null;
      })
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <>
      {/* Print-only stylesheet: each card on its own page. */}
      <style>{`
        @media print {
          .section-print-toolbar { display: none !important; }
          .section-print-card { page-break-after: always; break-after: page; }
          .section-print-card:last-child { page-break-after: auto; break-after: auto; }
          @page { size: 8.5in 11in; margin: 0.5in; }
        }
        @media screen {
          .section-print-card {
            margin: 0 auto 1.5rem auto;
            box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.08);
          }
        }
      `}</style>

      <div className="section-print-toolbar mx-auto flex w-full max-w-[8.5in] flex-col gap-4 px-4 py-6">
        <Link
          href={`/markbook/report-cards?section_id=${sectionId}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to {section.name}
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Section batch · {ay.label} · Term {viewingTermNumber}
            </p>
            <h1 className="font-serif text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground">
              Print {section.name} report cards.
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {cards.length} card{cards.length === 1 ? '' : 's'} ready to print.
              The browser dialog opens automatically — choose{' '}
              <strong>Save as PDF</strong> as the destination to get one file
              for the whole section.
            </p>
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[8.5in] flex-col">
        {cards.length === 0 && (
          <div className="section-print-toolbar px-4 py-12 text-center text-sm text-muted-foreground">
            No active students in this section to print.
          </div>
        )}
        {cards.map(({ studentId, payload }) => (
          <div key={studentId} className="section-print-card">
            <ReportCardDocument
              payload={payload}
              viewingTermNumber={viewingTermNumber}
            />
          </div>
        ))}
      </div>

      {cards.length > 0 && <AutoPrintTrigger enabled />}
    </>
  );
}
