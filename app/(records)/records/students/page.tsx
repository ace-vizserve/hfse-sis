import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  GraduationCap,
  Hourglass,
  Search,
  Table2,
  UserMinus,
  Users,
} from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { CrossAySearch } from '@/components/sis/cross-ay-search';
import {
  StudentDataTable,
  type StatusBucketDef,
} from '@/components/sis/student-data-table';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { listStudents, type StudentListRow } from '@/lib/sis/queries';
import { listHouses } from '@/lib/sis/houses';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function RecordsStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
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

  const service = createServiceClient();
  const { ay: ayParam } = await searchParams;
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const [allStudents, unsyncedCount] = await Promise.all([
    listStudents(selectedAy, 'name_asc'),
    countUnsyncedEnrolledStudents(selectedAy),
  ]);
  const isOperational = sessionUser.role === 'academic_coordinator';

  // Records is the permanent cross-year record of enrolled students only.
  // Pre-enrolment applications live on /admissions/applications.
  const ENROLLED = new Set(['Enrolled', 'Enrolled (Conditional)']);
  const students = allStudents.filter((s) =>
    ENROLLED.has((s.applicationStatus ?? '').trim())
  );

  // Merge enrollment_status + index_number from section_students so the Late
  // enrollee tab works and the # column shows the per-section roll number.
  // Fetch all rows — maps capture the non-withdrawn row (i.e. the current
  // active row for a transferred student); withdrawn count is the set of
  // enrolee_numbers that have a withdrawn row but no active/late_enrollee row.
  // `enrolee_number` is AY-scoped (resets each AY per KD #4/#13), so the
  // .in() filter naturally restricts to the selected AY's students.
  const enrollmentStatusMap = new Map<string, string>();
  const indexNumberMap = new Map<string, number>();
  let withdrawnFromSections = 0;
  if (students.length > 0) {
    const { data: ssRows } = await service
      .from('section_students')
      .select('enrolee_number, enrollment_status, index_number')
      .in(
        'enrolee_number',
        students.map((s) => s.enroleeNumber)
      );
    for (const r of ssRows ?? []) {
      if (!r.enrolee_number) continue;
      if (r.enrollment_status !== 'withdrawn') {
        enrollmentStatusMap.set(
          r.enrolee_number,
          r.enrollment_status as string
        );
        // index_number is per-section; take the active row's value.
        if (r.index_number != null) {
          indexNumberMap.set(r.enrolee_number, r.index_number as number);
        }
      }
    }
    // Truly withdrawn = has a withdrawn row, no active/late_enrollee row
    const withdrawnSet = new Set(
      (ssRows ?? [])
        .filter(
          (r) =>
            r.enrollment_status === 'withdrawn' &&
            r.enrolee_number &&
            !enrollmentStatusMap.has(r.enrolee_number!)
        )
        .map((r) => r.enrolee_number)
    );
    withdrawnFromSections = withdrawnSet.size;
  }

  // House. `StudentListRow` is built entirely from the admissions tables and
  // carries nothing from `public.students`, so the house has to be joined on
  // here — beside the section_students merge above, which exists for the same
  // reason. Keyed by studentNumber (Hard Rule #4); students without one yet
  // simply have no house.
  const houses = await listHouses();
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const houseByStudentNumber = new Map<string, string>();
  const studentNumbers = students
    .map((s) => s.studentNumber)
    .filter((n): n is string => !!n);
  if (studentNumbers.length > 0) {
    const rows = await fetchInChunks(studentNumbers, (slice) =>
      fetchAllPages<{ student_number: string; house_id: string | null }>(
        (from, to) =>
          service
            .from('students')
            .select('student_number, house_id')
            .in('student_number', slice)
            .order('student_number')
            .range(from, to)
      )
    );
    for (const r of rows) {
      if (r.house_id) houseByStudentNumber.set(r.student_number, r.house_id);
    }
  }

  const studentsWithStatus: StudentListRow[] = students.map((s) => ({
    ...s,
    enrollmentStatus: enrollmentStatusMap.get(s.enroleeNumber) ?? null,
    indexNumber: indexNumberMap.get(s.enroleeNumber) ?? null,
    house:
      s.studentNumber && houseByStudentNumber.has(s.studentNumber)
        ? (houseById.get(houseByStudentNumber.get(s.studentNumber)!)?.name ??
          null)
        : null,
    houseColourToken:
      s.studentNumber && houseByStudentNumber.has(s.studentNumber)
        ? (houseById.get(houseByStudentNumber.get(s.studentNumber)!)
            ?.colourToken ?? null)
        : null,
  }));

  const activeCount = studentsWithStatus.filter(
    (s) => s.enrollmentStatus === 'active'
  ).length;
  const lateEnrolleeCount = studentsWithStatus.filter(
    (s) => s.enrollmentStatus === 'late_enrollee'
  ).length;

  const RECORDS_STATUS_BUCKETS: StatusBucketDef[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active', enrollmentStatuses: ['active'] },
    {
      key: 'late_enrollee',
      label: 'Late enrollee',
      enrollmentStatuses: ['late_enrollee'],
    },
  ];

  return (
    <PageShell>
      <Link
        href="/records"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · Enrolled students
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Student records.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Enrolled students only. Click a row to open the cross-year permanent
            record (grades, attendance, and class-placement history across every
            AY). Pre- enrolment applications are on the Admissions module.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {selectedAy}
            </Badge>
            {isCurrentAy ? (
              <Badge className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                Current
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Historical
              </Badge>
            )}
          </div>
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      {/* Unsynced-students banner — surfaces the gap registrars can't otherwise
          see from this list (unsynced students never made it into
          public.students so they're absent from the roster below). */}
      {unsyncedCount > 0 && isCurrentAy && isOperational && (
        <Alert variant="warning">
          <AlertIcon variant="warning">
            <AlertTriangle className="size-4" />
          </AlertIcon>
          <AlertTitle>
            {unsyncedCount.toLocaleString('en-SG')} enrolled student
            {unsyncedCount === 1 ? '' : 's'} not in this list
          </AlertTitle>
          <AlertDescription>
            They&rsquo;re enrolled in admissions but don&rsquo;t yet have a
            class section, so they&rsquo;re stranded outside grading and
            attendance.
          </AlertDescription>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="col-start-2 mt-2 w-fit"
          >
            <Link href="/records/unsynced">Review queue</Link>
          </Button>
        </Alert>
      )}

      {/* Summary stats */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <SummaryStat
            label="Enrolled students"
            value={students.length}
            icon={Users}
            footnote="In sections this AY"
          />
          <SummaryStat
            label="Active"
            value={activeCount}
            icon={GraduationCap}
            footnote="Current section placement"
          />
          <SummaryStat
            label="Late enrollees"
            value={lateEnrolleeCount}
            icon={Hourglass}
            footnote="Joined after term start"
          />
          <SummaryStat
            label="Withdrawn"
            value={withdrawnFromSections}
            icon={UserMinus}
            footnote="Left class mid-year"
          />
        </div>
      </section>

      {/* Cross-AY search — highlighted card */}
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Cross-year · Spans every AY
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Find a returning student
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Search className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <CrossAySearch />
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Matches on student number, name, or enrolee number across every AY
          this school has records for. Tap a result to open that AY&apos;s
          record.
        </CardFooter>
      </Card>

      {/* AY-scoped student table */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Current AY · {selectedAy}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            All students ({studentsWithStatus.length.toLocaleString('en-SG')})
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Table2 className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <StudentDataTable
            data={studentsWithStatus}
            ayCode={selectedAy}
            linkBase="/records/students"
            linkAttribute="studentNumber"
            statusBuckets={RECORDS_STATUS_BUCKETS}
          />
        </CardContent>
      </Card>

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Table2 className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>
          {studentsWithStatus.length.toLocaleString('en-SG')} students
        </span>
        <span className="text-border">·</span>
        <span>Refreshes every 10 minutes</span>
      </div>
    </PageShell>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">
        {footnote}
      </CardFooter>
    </Card>
  );
}
