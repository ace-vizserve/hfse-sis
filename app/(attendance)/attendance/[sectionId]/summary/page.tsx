import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExportSheetButton } from '@/components/attendance/export-sheet-button';
import { TermSheetSummaryTable } from '@/components/attendance/term-sheet-summary-table';
import { Card, CardDescription } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getDedupedSchoolCalendarForTerm } from '@/lib/attendance/calendar';
import { getDailyForSection } from '@/lib/attendance/queries';
import {
  buildTermSummaryRows,
  monthsInRange,
  type TermSummaryEnrolment,
} from '@/lib/attendance/sheet-summary';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { createClient } from '@/lib/supabase/server';

type LevelLite = { code: string; label: string };
type SectionRow = {
  id: string;
  name: string;
  academic_year_id: string;
  level: LevelLite | LevelLite[] | null;
};

export default async function TermSheetSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  const supabase = await createClient();

  const { data: sectionRaw } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, level:levels(code, label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!sectionRaw) notFound();
  const section = sectionRaw as SectionRow;
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  const { data: termsRaw } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current, start_date, end_date')
    .eq('academic_year_id', section.academic_year_id)
    .order('term_number', { ascending: true });
  type TermRow = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termsRaw ?? []) as TermRow[];

  const todayIso = sgToday();
  const selectedTermId =
    (sp.term_id && terms.find((t) => t.id === sp.term_id)?.id) ??
    resolveCurrentTermId(terms, todayIso);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

  if (!selectedTermId) {
    return (
      <PageShell>
        <Card className="items-center py-12 text-center">
          <CardDescription>No term configured for this AY.</CardDescription>
        </Card>
      </PageShell>
    );
  }

  const { data: enrolmentsRaw } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, student:students(last_name, first_name, middle_name)'
    )
    .eq('section_id', sectionId)
    .order('index_number');

  type EnrolmentRow = {
    id: string;
    index_number: number;
    enrollment_status: string;
    enrollment_date: string | null;
    student:
      | { last_name: string; first_name: string; middle_name: string | null }
      | Array<{
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }>
      | null;
  };
  const enrolmentList = (enrolmentsRaw ?? []) as EnrolmentRow[];

  const sectionLevelType = levelTypeForAudienceLookup(level?.code ?? null);

  const [calendar, daily] = await Promise.all([
    getDedupedSchoolCalendarForTerm(selectedTermId, sectionLevelType),
    getDailyForSection(sectionId, selectedTermId),
  ]);

  const enrolments: TermSummaryEnrolment[] = enrolmentList.map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const fullName =
      s != null
        ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
        : '—';
    return {
      enrolmentId: e.id,
      indexNumber: e.index_number,
      studentName: fullName,
      withdrawn: e.enrollment_status === 'withdrawn',
      enrollmentDate: e.enrollment_date ?? null,
    };
  });

  const months = monthsInRange(calendar);
  const rows = buildTermSummaryRows(enrolments, calendar, daily);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Link
            href={`/attendance/${sectionId}?term_id=${selectedTermId}`}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {section.name}
          </Link>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Term Sheet Summary
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every student&apos;s monthly attendance breakdown for this term, in
            the same layout as the printed attendance sheet.
          </p>
        </div>
        <ExportSheetButton sectionId={sectionId} termId={selectedTermId} />
      </header>

      {terms.length > 1 && (
        <Tabs value={selectedTermId} aria-label="Term">
          <TabsList>
            {terms.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/attendance/${sectionId}/summary?term_id=${t.id}`}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      current
                    </span>
                  )}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {calendar.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardDescription>
            No calendar configured for {selectedTerm?.label ?? 'this term'}.
          </CardDescription>
        </Card>
      ) : (
        <TermSheetSummaryTable rows={rows} months={months} />
      )}
    </PageShell>
  );
}
