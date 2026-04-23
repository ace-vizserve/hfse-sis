import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CalendarCheck, CalendarDays, Percent } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AttendanceReadOnlyTable,
  type ReadOnlyRow,
} from '@/components/markbook/attendance-readonly-table';

type LevelLite = { code: string; label: string };
type TermLite = { id: string; label: string; term_number: number; is_current: boolean };

export default async function SectionAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const supabase = await createClient();

  const { data: section } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, level:levels(code, label)')
    .eq('id', id)
    .single();
  if (!section) notFound();
  const level = (Array.isArray(section.level) ? section.level[0] : section.level) as
    | LevelLite
    | null;

  const { data: terms } = await supabase
    .from('terms')
    .select('id, label, term_number, is_current')
    .eq('academic_year_id', section.academic_year_id)
    .order('term_number');
  const termList = (terms ?? []) as TermLite[];
  const currentTerm = termList.find((t) => t.is_current) ?? termList[0];
  const selectedTermId = q.term_id ?? currentTerm?.id ?? '';
  const selectedTerm = termList.find((t) => t.id === selectedTermId);

  const { data: enrolments } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, student:students(student_number, last_name, first_name, middle_name)',
    )
    .eq('section_id', id)
    .order('index_number');

  const enrolmentIds = (enrolments ?? []).map((e) => e.id);
  const { data: records } =
    selectedTermId && enrolmentIds.length > 0
      ? await supabase
          .from('attendance_records')
          .select(
            'section_student_id, school_days, days_present, days_late, days_excused, days_absent, attendance_pct',
          )
          .eq('term_id', selectedTermId)
          .in('section_student_id', enrolmentIds)
      : { data: [] };
  type RollupLite = {
    section_student_id: string;
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
    days_excused: number | null;
    days_absent: number | null;
    attendance_pct: number | null;
  };
  const byEnrolment = new Map(
    ((records ?? []) as RollupLite[]).map((r) => [r.section_student_id, r]),
  );

  const rows: ReadOnlyRow[] = (enrolments ?? []).map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const rec = byEnrolment.get(e.id);
    return {
      enrolmentId: e.id,
      indexNumber: e.index_number,
      withdrawn: e.enrollment_status === 'withdrawn',
      studentNumber: s?.student_number ?? '',
      studentName: s
        ? [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', ')
        : '(missing)',
      schoolDays: rec?.school_days ?? null,
      daysPresent: rec?.days_present ?? null,
      daysLate: rec?.days_late ?? null,
      daysExcused: rec?.days_excused ?? null,
      daysAbsent: rec?.days_absent ?? null,
      attendancePct: rec?.attendance_pct != null ? Number(rec.attendance_pct) : null,
    };
  });

  // Aggregate stats for the current term (active students only).
  const active = rows.filter((r) => !r.withdrawn);
  const marked = active.filter((r) => r.schoolDays != null);
  const schoolDays = marked.reduce((m, r) => Math.max(m, r.schoolDays ?? 0), 0) || null;
  const pctValues = marked
    .map((r) => r.attendancePct)
    .filter((n): n is number => n != null);
  const avgRate =
    pctValues.length > 0
      ? Math.round((pctValues.reduce((s, n) => s + n, 0) / pctValues.length) * 100) / 100
      : null;
  const perfect = marked.filter(
    (r) => (r.daysAbsent ?? 0) === 0 && (r.daysLate ?? 0) === 0 && (r.schoolDays ?? 0) > 0,
  ).length;

  return (
    <PageShell>
      <Link
        href={`/markbook/sections/${id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {level?.label} {section.name}
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Section · Attendance
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              Attendance.
            </h1>
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {level?.label} {section.name}
            </Badge>
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Read-only rollup of daily attendance. Mark, correct, or import in the Attendance
            module — edits flow back here automatically.
          </p>
        </div>
        <Button asChild variant="default" size="sm" className="gap-1.5">
          <Link href={`/attendance/${id}`}>
            Mark attendance
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </header>

      {/* Term switcher */}
      {termList.length > 0 && (
        <Tabs value={selectedTermId}>
          <TabsList>
            {termList.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/markbook/sections/${id}/attendance?term_id=${t.id}`}>
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

      {/* Stats */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description={`${selectedTerm?.label ?? 'Term'} · School days`}
            value={schoolDays == null ? '—' : schoolDays.toLocaleString('en-SG')}
            icon={CalendarDays}
            footerTitle={
              schoolDays == null ? 'Not marked yet' : `${marked.length} of ${active.length} marked`
            }
            footerDetail="Max across students (NC days excluded)"
          />
          <StatCard
            description="Average attendance"
            value={avgRate == null ? '—' : `${avgRate.toFixed(1)}%`}
            icon={Percent}
            footerTitle={
              avgRate == null
                ? 'No data yet'
                : `Across ${pctValues.length} ${pctValues.length === 1 ? 'student' : 'students'}`
            }
            footerDetail="Present ÷ school days"
          />
          <StatCard
            description="Perfect attendance"
            value={perfect.toLocaleString('en-SG')}
            icon={CalendarCheck}
            footerTitle={perfect === 0 ? 'None yet' : 'Zero absences or lates'}
            footerDetail={`Of ${active.length} active students`}
          />
        </div>
      </div>

      <AttendanceReadOnlyTable rows={rows} />
    </PageShell>
  );
}

function StatCard({
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
