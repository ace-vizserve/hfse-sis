import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Percent,
  Users,
} from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
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
  getCalendarEventsForTerm,
  getDedupedSchoolCalendarForTerm,
} from '@/lib/attendance/calendar';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import {
  getCompassionateUsageForSection,
  getDailyForSection,
  getSectionAttendanceSummary,
  getVacationLeaveUsageForSection,
} from '@/lib/attendance/queries';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import {
  AttendanceWideGrid,
  type WideGridEnrolment,
} from '@/components/attendance/wide-grid';
import { StudentLookupSheet } from '@/components/attendance/student-lookup-sheet';
import { DailyEntry } from '@/components/attendance/daily-entry';

type LevelLite = { code: string; label: string };
type SectionRow = {
  id: string;
  name: string;
  academic_year_id: string;
  level: LevelLite | LevelLite[] | null;
};

export default async function SectionAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string; view?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;
  const view: 'sheet' | 'daily' = sp.view === 'daily' ? 'daily' : 'sheet';

  const session = await getSessionUser();
  const role = session?.role ?? null;
  const canWriteNc =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

  const supabase = await createClient();

  const { data: sectionRaw } = await supabase
    .from('sections')
    .select('id, name, academic_year_id, level:levels(code, label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (!sectionRaw) notFound();
  const section = sectionRaw as SectionRow;
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  // Terms — pick a term from ?term_id or default to current.
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

  // "Today" in Singapore time — the daily view marks the real calendar day,
  // so resolve it server-side for SSR / timezone consistency (canonical helper).
  const todayIso = sgToday();

  // Daily view targets the current term (term containing today → most-recent
  // during a break) via the shared resolver; the term switcher is hidden. When
  // today is in a break the daily view detects today isn't a school day in the
  // resolved term and renders the "no classes" state. The sheet view keeps its
  // ?term_id default (falling back to the same resolver).
  const selectedTermId =
    view === 'daily'
      ? resolveCurrentTermId(terms, todayIso)
      : ((sp.term_id && terms.find((t) => t.id === sp.term_id)?.id) ??
        resolveCurrentTermId(terms, todayIso));
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

  // Form adviser display (for header).
  const { data: advisers } = await supabase
    .from('teacher_assignments')
    .select('teacher_user_id, role')
    .eq('section_id', sectionId)
    .eq('role', 'form_adviser')
    .limit(1);
  const adviserUserId = advisers?.[0]?.teacher_user_id ?? null;
  // We don't have a user-names table; email is looked up via auth but we
  // skip that here — the section.name + level is enough for the header.

  // Enrolment roster — include new metadata fields from migration 015 +
  // vacation_leave_allowance_per_term from migration 048 (KD #94).
  const { data: enrolmentsRaw } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, bus_no, classroom_officer_role, student:students(id, student_number, last_name, first_name, middle_name, urgent_compassionate_allowance, vacation_leave_allowance_per_term)'
    )
    .eq('section_id', sectionId)
    .order('index_number');

  type EnrolmentRow = {
    id: string;
    index_number: number;
    enrollment_status: string;
    enrollment_date: string | null;
    bus_no: string | null;
    classroom_officer_role: string | null;
    student:
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
          urgent_compassionate_allowance: number | null;
          vacation_leave_allowance_per_term: number | null;
        }
      | Array<{
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
          urgent_compassionate_allowance: number | null;
          vacation_leave_allowance_per_term: number | null;
        }>
      | null;
  };

  const enrolmentList = (enrolmentsRaw ?? []) as EnrolmentRow[];

  // Fetch calendar + events + daily + quota in parallel.
  // Audience scope (KD #76): the section's level type drives which calendar
  // rows + events are visible. `getDedupedSchoolCalendarForTerm` returns
  // exactly one row per date (level-specific override wins over the 'all'
  // baseline) so the grid never renders the same date twice. Calendar
  // events filter to ['all', levelType] so primary/secondary-only events
  // stay scoped to the right cohort.
  const sectionLevelType = levelTypeForAudienceLookup(level?.code ?? null);
  const audienceForEvents = sectionLevelType ?? 'all';
  const [
    calendar,
    events,
    daily,
    quotaByEnrolmentId,
    vlQuotaByEnrolmentId,
    summary,
    schoolConfig,
  ] = await Promise.all([
    getDedupedSchoolCalendarForTerm(selectedTermId, sectionLevelType),
    getCalendarEventsForTerm(selectedTermId, audienceForEvents),
    getDailyForSection(sectionId, selectedTermId),
    getCompassionateUsageForSection(sectionId, section.academic_year_id),
    getVacationLeaveUsageForSection(
      sectionId,
      section.academic_year_id,
      selectedTermId
    ),
    getSectionAttendanceSummary(sectionId, selectedTermId),
    getSchoolConfig(),
  ]);

  const enrolments: WideGridEnrolment[] = enrolmentList.map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const fullName =
      s != null
        ? `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}`
        : '—';
    const quota = quotaByEnrolmentId.get(e.id);
    const vlQuota = vlQuotaByEnrolmentId.get(e.id);
    return {
      enrolmentId: e.id,
      indexNumber: e.index_number,
      studentNumber: s?.student_number ?? '—',
      studentName: fullName,
      busNo: e.bus_no,
      classroomOfficerRole: e.classroom_officer_role,
      withdrawn: e.enrollment_status === 'withdrawn',
      enrollmentDate: e.enrollment_date ?? null,
      compassionateUsed: quota?.used ?? 0,
      compassionateAllowance:
        quota?.allowance ?? s?.urgent_compassionate_allowance ?? 5,
      vlUsedThisTerm: vlQuota?.usedThisTerm ?? 0,
      vlAllowance:
        vlQuota?.allowance ??
        s?.vacation_leave_allowance_per_term ??
        schoolConfig.defaultVlAllowancePerTerm,
    };
  });

  const activeCount = enrolments.filter((e) => !e.withdrawn).length;
  const holidayCount = calendar.filter((c) => c.isHoliday).length;
  const schoolDayCount = calendar.filter((c) => !c.isHoliday).length;

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Link
            href="/attendance"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            All sections
          </Link>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {section.name}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {view === 'daily'
              ? "Mark today's class in one pass — everyone's present unless you say otherwise. Step back a day to catch up a missed one, then submit."
              : 'Excel-style attendance sheet for the whole term. Holidays are greyed out. Edits autosave per cell; corrections append a new ledger row.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-7 border-border bg-background px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {level?.code ?? ''} · {level?.label ?? ''}
          </Badge>
          <Tabs value={view} aria-label="View">
            <TabsList>
              <TabsTrigger value="sheet" asChild>
                <Link
                  href={`/attendance/${sectionId}?term_id=${selectedTermId}`}
                >
                  Term sheet
                </Link>
              </TabsTrigger>
              <TabsTrigger value="daily" asChild>
                <Link
                  href={`/attendance/${sectionId}?term_id=${selectedTermId}&view=daily`}
                >
                  Daily
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <StudentLookupSheet
            enrolments={enrolments}
            termLabel={selectedTerm?.label ?? ''}
          />
          {canWriteNc && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/sis/calendar?term_id=${selectedTermId}`}>
                <CalendarDays className="size-3.5" />
                Configure calendar
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Term switcher — sheet view only; daily is locked to the current term. */}
      {view === 'sheet' && terms.length > 1 && (
        <Tabs value={selectedTermId} aria-label="Term">
          <TabsList>
            {terms.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`/attendance/${sectionId}?term_id=${t.id}`}>
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

      {/* Term-level stats — sheet view only. The daily view renders its own
          day-focused stat cards inside <DailyEntry>. */}
      {view === 'sheet' && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-4">
            <StatCard
              description="Students"
              value={activeCount.toLocaleString('en-SG')}
              icon={Users}
              footerTitle="Active roster"
              footerDetail={`${enrolments.length - activeCount} withdrawn`}
            />
            <StatCard
              description="School days"
              value={schoolDayCount.toLocaleString('en-SG')}
              icon={CalendarDays}
              footerTitle={
                schoolDayCount === 0
                  ? 'Not configured'
                  : `${holidayCount} ${holidayCount === 1 ? 'holiday' : 'holidays'}`
              }
              footerDetail={selectedTerm?.label ?? ''}
            />
            <StatCard
              description="Average attendance"
              value={
                summary.averageAttendancePct != null
                  ? `${summary.averageAttendancePct.toFixed(1)}%`
                  : '—'
              }
              icon={Percent}
              footerTitle="Across marked students"
              footerDetail="Present ÷ school days"
            />
            <StatCard
              description="Perfect attendance"
              value={summary.perfectAttendanceCount.toLocaleString('en-SG')}
              icon={CalendarCheck}
              footerTitle={
                summary.perfectAttendanceCount === 0
                  ? 'None yet'
                  : 'Zero absences'
              }
              footerDetail={`of ${activeCount} students`}
            />
          </div>
        </div>
      )}

      {/* key forces a remount on section/term change so the grid re-seeds its
          internal cell state from the freshly-fetched `initialDaily`. Without
          it, switching terms via the client-side <Link> tabs keeps the grid
          mounted and its useState initializer never re-runs — the new term's
          date columns render with empty cells even though data exists. */}
      {view === 'daily' ? (
        <DailyEntry
          key={`daily:${sectionId}:${selectedTermId}`}
          sectionId={sectionId}
          termId={selectedTermId}
          enrolments={enrolments}
          calendar={calendar}
          events={events}
          initialDaily={daily}
          today={todayIso}
        />
      ) : (
        <AttendanceWideGrid
          key={`${sectionId}:${selectedTermId}`}
          sectionId={sectionId}
          termId={selectedTermId}
          enrolments={enrolments}
          calendar={calendar}
          events={events}
          initialDaily={daily}
          canWriteNc={canWriteNc}
        />
      )}

      {/* Adviser name reminder */}
      {!adviserUserId && (
        <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          No form adviser assigned to this section yet. Assign one from Markbook
          &rarr; Sections &rarr; Teachers so the adviser sees this page.
        </Card>
      )}
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
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
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
