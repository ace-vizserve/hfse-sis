import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { PublicationStatus } from '@/components/admin/publication-status';
import { PrintButton } from './print-button';

export default async function ReportCardPreview({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
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

  return (
    <div className="space-y-6">
      {/* Registrar controls — hidden from the "paper" preview below. */}
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6 print:hidden">
        <Link
          href="/report-cards"
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

        <PublicationStatus sectionId={payload.section.id} terms={payload.terms} />
      </div>

      {/* --- Report card "paper" --- */}
      <ReportCardDocument payload={payload} />
    </div>
  );
}
