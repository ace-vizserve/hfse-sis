import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getStudentsByParentEmail } from '@/lib/supabase/admissions';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { Card, CardContent } from '@/components/ui/card';

export default async function ParentReportCardPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? '';

  // 1) Verify parent→student linkage via admissions, for the current AY.
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) notFound();
  const admissionsRows = await getStudentsByParentEmail(email, currentAy.ay_code);
  const allowedStudentNumbers = new Set(admissionsRows.map((r) => r.student_number));

  // 2) Resolve studentId → student_number to check ownership (student may
  //    exist in grading DB under a student_number we know belongs to this
  //    parent).
  const { data: student } = await service
    .from('students')
    .select('id, student_number')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || !allowedStudentNumbers.has(student.student_number)) {
    notFound();
  }

  // 3) Build the report card payload via the shared helper (using service
  //    client since the parent's cookie-bound client can't read grade
  //    tables per RLS 005).
  const result = await buildReportCard(service, studentId);
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

  // 4) Gate: is there at least one active publication window for this
  //    student's section? If none, show a polite "not available yet" state
  //    instead of rendering the report card.
  const { data: publications } = await service
    .from('report_card_publications')
    .select('id, term_id, publish_from, publish_until')
    .eq('section_id', payload.section.id);

  // Server component runs per-request; current time is required to verify
  // the publication window.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const activePubs = (publications ?? []).filter((p) => {
    const from = new Date(p.publish_from as string).getTime();
    const until = new Date(p.publish_until as string).getTime();
    return now >= from && now <= until;
  });

  if (activePubs.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <Link
          href="/parent"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          My children
        </Link>

        <header className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Report card · {payload.ay.label}
          </p>
          <h1 className="font-serif text-[32px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[38px]">
            {payload.student.full_name}.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {payload.level.label} · {payload.section.name}
          </p>
        </header>

        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            This report card is not currently available to view. The school will publish it when
            it&apos;s ready.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Parent chrome — hidden when printing. */}
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6 print:hidden">
        <Link
          href="/parent"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          My children
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
          <div className="text-xs text-muted-foreground">
            <Printer className="mr-1 inline h-3 w-3" />
            Press <kbd className="rounded border border-border bg-card px-1 py-0.5">Ctrl</kbd>
            {' + '}
            <kbd className="rounded border border-border bg-card px-1 py-0.5">P</kbd> to print or
            save as PDF
          </div>
        </header>
      </div>

      <ReportCardDocument payload={payload} />
    </div>
  );
}
