import { ArrowLeft, FileText, MailWarning, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import {
  FileDisciplineRecordButton,
  type FilingStudent,
} from '@/components/discipline/file-record-button';
import { DisciplineTable } from '@/components/sis/discipline-table';
import { Badge } from '@/components/ui/badge';
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
import { AllYearsSwitch } from '@/components/discipline/all-years-switch';
import {
  listDisciplineForAllAys,
  listDisciplineForAy,
} from '@/lib/discipline/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// The school-wide disciplinary register, and the one place a record is filed.
//
// Mr Ace, 2026-08-21, on why the register exists at all: "every data … needs a
// page where to see all … then since you see users you must see a user … then
// also update it as well." Until it existed, a record was reachable class by
// class only, and "which letters are still waiting on a signed slip" could not
// be asked of the whole school.
//
// ⚠ IT MOVED HERE FROM `/records/discipline` ON 2026-09-11, AND IT IS NOW THE
// FILING SURFACE — both halves of that reverse what this file used to say.
// Christina Labrador, T4 teachers' training, 10 Sep: *"make it just a view tab
// for all the teachers, rather than use it to file incidents. So we have one
// centralized template to file any incident, and it goes to the student's
// record… We don't use this to file any incident."* Filing left the Classroom
// tab, the class page and the student drawer; this page is where it went. Ms
// Tin asked for the same split from the other side.
//
// ⚠ STILL NO DELETE, anywhere in this feature — the API has none by design,
// because a child's behavioural record that can vanish is worth less than one
// that cannot. Corrections are edits, and they are audited.
//
// ⚠ `admissions` WAS DROPPED FROM THE GUARD, deliberately. They could open the
// old Records page only because that module admits them broadly; nobody
// decided they should read the school's behavioural records, and discipline is
// not admissions work. Decided with Mr Ace, 2026-09-11.

export default async function ClassroomDisciplinePage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; scope?: string }>;
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
  const { ay: ayParam, scope } = await searchParams;
  const allYears = scope === 'all';
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);

  const selectedAy = ayParam ?? currentAy?.ay_code ?? ayCodes[0] ?? '';
  const isCurrentAy = selectedAy === currentAy?.ay_code;

  // The switcher speaks in AY codes; the records are keyed by the year's id.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', selectedAy)
    .maybeSingle();
  const academicYearId = (ayRow as { id: string } | null)?.id ?? null;

  const records = allYears
    ? await listDisciplineForAllAys()
    : academicYearId
      ? await listDisciplineForAy(academicYearId)
      : [];

  // The roll for the filing picker — every student in every class of the
  // selected year. Read with the service client because this page is already
  // gated to the three office roles, and `canReadRoster` resolves 'oversight'
  // for all of them on every section anyway (lib/classroom/scope.ts).
  //
  // ⚠ WITHDRAWN STUDENTS ARE EXCLUDED FROM FILING, not from the register. A
  // record already filed against a child who later left stays on the list
  // above — it happened — but there is no filing a new one against somebody no
  // longer on roll.
  const { data: rollRows } = academicYearId
    ? await service
        .from('section_students')
        .select(
          'index_number, section:sections!inner(id, name, academic_year_id), student:students(student_number, last_name, first_name, middle_name)'
        )
        .eq('section.academic_year_id', academicYearId)
        .neq('enrollment_status', 'withdrawn')
        .order('index_number')
    : { data: null };

  type RollRow = {
    index_number: number;
    section: { id: string; name: string } | null;
    student: {
      student_number: string;
      last_name: string;
      first_name: string;
      middle_name: string | null;
    } | null;
  };

  const roll: FilingStudent[] = ((rollRows ?? []) as unknown as RollRow[])
    .filter((r) => r.student?.student_number && r.section?.id)
    .map((r) => ({
      studentNumber: r.student!.student_number,
      studentName: [
        r.student!.last_name,
        r.student!.first_name,
        r.student!.middle_name,
      ]
        .filter(Boolean)
        .join(', '),
      sectionId: r.section!.id,
      sectionName: r.section!.name,
      indexNumber: r.index_number,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  const lettersWaiting = records.filter(
    (r) => r.recordType === 'letter' && !r.acknowledgedOn
  ).length;
  const studentsInvolved = new Set(records.map((r) => r.studentId)).size;

  return (
    <PageShell>
      <Link
        href="/classroom"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All classes
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom · Discipline
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Disciplinary records.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every incident and letter filed this year, newest first, and the one
            place a new one is filed. Teachers see their own class&apos;s
            records on the class page, but do not file there.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {/* The page's one primary CTA (§9.2). Only on the current year —
              filing a record into a closed year would be filing a fact about
              a class that no longer meets. */}
          {isCurrentAy && roll.length > 0 && (
            <FileDisciplineRecordButton students={roll} />
          )}
          {/* The year badges and the switcher both describe a single year, so
              neither means anything while every year is on screen. */}
          {allYears ? (
            <Badge
              variant="outline"
              className="h-7 border-border px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              All years
            </Badge>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="h-7 border-border px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
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
                    className="h-7 border-border px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Historical
                  </Badge>
                )}
              </div>
              <AySwitcher current={selectedAy} options={ayCodes} />
            </>
          )}
        </div>
      </header>

      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <SummaryStat
            label="Records"
            value={records.length}
            icon={FileText}
            footnote={
              allYears ? 'Filed, all years' : 'Filed this academic year'
            }
          />
          {/* The one figure here anyone can act on. The school's letter gives
              the parent two days to return the slip; nothing in this app
              chases it, so seeing the count is the whole mechanism. */}
          <SummaryStat
            label="Slips outstanding"
            value={lettersWaiting}
            icon={MailWarning}
            footnote="Letters with no signed slip back"
          />
          <SummaryStat
            label="Students"
            value={studentsInvolved}
            icon={Users}
            footnote="With at least one record"
          />
        </div>
      </section>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {allYears
              ? 'Every year'
              : `${isCurrentAy ? 'Current AY' : 'Historical'} · ${selectedAy}`}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            All records ({records.length.toLocaleString('en-SG')})
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileText className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <DisciplineTable
            records={records}
            ayCode={selectedAy}
            allYears={allYears}
            toolbarLeading={<AllYearsSwitch allYears={allYears} />}
          />
        </CardContent>
      </Card>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {allYears ? 'All years' : selectedAy} · Every filing and every
        correction is recorded on the audit log
      </p>
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
