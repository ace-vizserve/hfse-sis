import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { PublicationStatus } from '@/components/admin/publication-status';
import { PrintButton } from './print-button';
import { cn } from '@/lib/utils';

export default async function ReportCardPreview({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { studentId } = await params;
  const { term: termParam } = await searchParams;
  const supabase = await createClient();

  const result = await buildReportCard(supabase, studentId);
  if (!result.ok) {
    if (result.error.kind === 'student_not_found' || result.error.kind === 'level_not_found') {
      notFound();
    }
    if (result.error.kind === 'no_current_ay') {
      return <div className="text-destructive">No current academic year.</div>;
    }
    if (result.error.kind === 'not_enrolled_this_ay') {
      return (
        <div className="text-sm text-muted-foreground">
          Student is not enrolled in the current academic year ({result.error.ayLabel}).
        </div>
      );
    }
  }
  if (!result.ok) notFound();
  const payload = result.payload;

  // Determine which term to view: from URL param, or default to current term.
  // AY-scope the lookup so stale `is_current=true` flags on past-AY terms
  // don't make `.maybeSingle()` throw a "more than one row" error.
  const { data: currentTermRow } = await supabase
    .from('terms')
    .select('term_number')
    .eq('academic_year_id', payload.ay.id)
    .eq('is_current', true)
    .maybeSingle();
  const parsedTerm = termParam ? parseInt(termParam, 10) : NaN;
  const viewingTermNumber = (
    [1, 2, 3, 4].includes(parsedTerm)
      ? parsedTerm
      : currentTermRow?.term_number ?? 1
  ) as 1 | 2 | 3 | 4;
  const isFinal = viewingTermNumber === 4;

  return (
    <div className="space-y-6">
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6 print:hidden">
        <Link
          href="/markbook/report-cards"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All report cards
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

        {/* Template switcher: Interim (T1–T3) vs Final (T4) */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <Link
            href={`/markbook/report-cards/${studentId}?term=1`}
            className={cn(
              'rounded-md px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors',
              !isFinal
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Interim (T1–T3)
          </Link>
          <Link
            href={`/markbook/report-cards/${studentId}?term=4`}
            className={cn(
              'rounded-md px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors',
              isFinal
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Final (T4)
          </Link>
        </div>

        <PublicationStatus sectionId={payload.section.id} terms={payload.terms} />
      </div>

      <ReportCardDocument payload={payload} viewingTermNumber={viewingTermNumber} />
    </div>
  );
}
