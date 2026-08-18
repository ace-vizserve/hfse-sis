import {
  ArrowUpRight,
  Award,
  BookOpen,
  CalendarCheck2,
  CalendarX2,
  CircleCheck,
  CircleX,
  ClipboardList,
  Clock,
  FileCheck2,
  GraduationCap,
  Info,
  LineChart,
  ListChecks,
  MessageSquareText,
  PieChart,
  School,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { BandDonut } from '@/components/markbook/band-donut';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { DASH, fmt, pct, pct1 } from '@/components/markbook/overview-cells';
import {
  OverviewLevelTable,
  type OverviewLevelTableRow,
} from '@/components/markbook/overview-level-table';
import { OverviewSubjectTable } from '@/components/markbook/overview-subject-table';
import {
  AttendanceTrendChart,
  TermTrendChart,
} from '@/components/markbook/term-trend-chart';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  buildOverviewHighlights,
  type AcademicOverview,
  type AttendanceHealth,
  type OverviewHighlight,
  type OverviewTermRow,
} from '@/lib/markbook/academic-overview-compute';

/** Severity reads as a colour, matching §9: destructive blocks, accent informs. */
const SEVERITY_DOT: Record<OverviewHighlight['severity'], string> = {
  bad: 'bg-destructive',
  warn: 'bg-brand-amber',
  info: 'bg-brand-indigo-soft',
};

// School-wide Academic Overview (all grade levels).
//
// A server component. The two big tables (grade levels, subjects) are client
// islands on the shared <DataTable> shell, so they carry sorting and column
// visibility; everything around them — the tiles, the per-term table, the
// student lists, the trends — still renders on the server with no client
// JavaScript. Cell formatting is shared with those islands through
// ./overview-cells so the same figure is produced by one function on both
// sides of the boundary.

/**
 * "Term 1 98.2% → Term 2 99.0%" — the movement behind the headline figure,
 * from the first term with a register to the latest. A single term states
 * itself; none says so rather than inventing a comparison.
 */
/** A day count as a share of the school days behind it. */
function dayRate(days: number, of: AttendanceHealth): number | null {
  if (of.schoolDays <= 0) return null;
  return Math.round((days / of.schoolDays) * 1000) / 10;
}

function attendanceMovement(terms: AttendanceHealth['terms']): string {
  const reported = terms.filter((t) => t.rate != null);
  if (reported.length === 0) return 'No register recorded yet';
  const first = reported[0];
  const last = reported[reported.length - 1];
  if (reported.length === 1) {
    return `Term ${first.termNumber} ${pct1(first.rate)}`;
  }
  return `Term ${first.termNumber} ${pct1(first.rate)} → Term ${last.termNumber} ${pct1(last.rate)}`;
}

function StatusBadge({ status }: { status: OverviewTermRow['status'] }) {
  if (status === 'completed') {
    return (
      <Badge
        variant="outline"
        className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
      >
        Completed
      </Badge>
    );
  }
  if (status === 'in_progress') {
    // Informational, not a warning — a term being taught is the normal state.
    // The accent recipe from 09a §9.1 rather than an amber of my own.
    return (
      <Badge
        variant="outline"
        className="h-6 border-brand-indigo-soft bg-accent text-accent-foreground"
      >
        In progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-6 text-muted-foreground">
      Not started
    </Badge>
  );
}

function QuickLink({
  eyebrow,
  title,
  description,
  href,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="@container/card group relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          <Link
            href={href}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title}
          </Link>
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
          Open
          <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </CardContent>
    </Card>
  );
}

/** Same card shell as the metric tiles — the strip is a row of stats, so it
 *  should not look like a different kind of surface. */
function StatusCard({
  label,
  value,
  footer,
  progressPct,
}: {
  label: string;
  value: string;
  footer?: string;
  progressPct?: number | null;
}) {
  return (
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="text-[17px] font-semibold tracking-tight text-foreground">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {progressPct != null && (
          <div
            className="mb-2 h-1.5 overflow-hidden rounded-full bg-border"
            role="img"
            aria-label={`${progressPct}% of the term elapsed`}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
        {footer ? (
          <p className="text-xs text-muted-foreground">{footer}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** "2026-06-29" → "29 Jun 2026". Dates are school-calendar facts, not metrics. */
function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function StatTile({
  label,
  value,
  footer,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  footer: string;
  icon: LucideIcon;
  /**
   * Only 'bad' tints the number. There is no 'good' counterpart on purpose:
   * mint is a background tint here, not a text colour, and a green headline
   * would be decoration — the at-risk count is the one that needs to be seen
   * across the room (09a §9.5, "colour carries meaning, never decoration").
   */
  tone?: 'bad';
}) {
  const valueTone = tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    // The canonical stat-card wash from 09a §8 — a flat white tile beside nine
    // other flat white tiles is what makes a dashboard read as inert.
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle
          className={`font-serif text-[30px] font-semibold leading-none tabular-nums ${valueTone}`}
        >
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{footer}</p>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  cap,
  title,
  scope,
  icon: Icon,
  aside,
  footer,
  children,
}: {
  cap: string;
  title: string;
  /** Restated on every card so a filtered figure is never read as the school's. */
  scope?: string | null;
  icon: LucideIcon;
  aside?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {cap}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
          {scope ? (
            <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
              ({scope})
            </span>
          ) : null}
        </CardTitle>
        {aside ? (
          <CardAction>
            <span className="text-xs text-muted-foreground">{aside}</span>
          </CardAction>
        ) : (
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        )}
      </CardHeader>
      {children}
      {footer ? (
        <div className="border-t border-border bg-muted/30 px-6 py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export function AcademicOverviewView({
  overview,
  levelHref,
}: {
  overview: AcademicOverview;
  /** Builds the link into the existing per-level dashboard. */
  levelHref: (levelId: string) => string;
}) {
  const {
    scale,
    kpis,
    coverage,
    termProgress,
    distribution,
    anomalies,
    attendance,
  } = overview;
  const rangeLabel = termProgress.reportedRangeLabel ?? 'No completed terms';
  const current = termProgress.current;
  const highlights = buildOverviewHighlights(overview);
  const scopeLabel = overview.scopeLabel;
  // A one-row ladder is not a ladder. Once a single level is in scope the
  // comparison it exists to make has no other side.
  const showLevelLadder = overview.levels.length > 1;
  const students = overview.studentLists;
  // Resolved here rather than in the table: `levelHref` is a function, and a
  // server component can only hand a client component serializable props.
  const levelRows: OverviewLevelTableRow[] = overview.levels.map((level) => ({
    ...level,
    href: levelHref(level.levelId),
  }));

  // Carry the live filter through to the focused views. Level and class are the
  // only two they understand — term and subject have no meaning on an awards or
  // attendance page, so they are deliberately dropped rather than passed and
  // silently ignored.
  const scopeParams = new URLSearchParams({ ay: overview.ayCode });
  if (overview.filters.levelId)
    scopeParams.set('level', overview.filters.levelId);
  if (overview.filters.sectionId)
    scopeParams.set('class', overview.filters.sectionId);
  const scopeQuery = `?${scopeParams.toString()}`;

  return (
    <div className="flex flex-col gap-8">
      {/* Where the year stands */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          label="Academic year"
          value={overview.ayCode}
          footer={termProgress.current ? 'Currently running' : 'Between terms'}
        />
        <StatusCard
          label="Term in progress"
          value={current ? `Term ${current.termNumber}` : 'No term running'}
          progressPct={current?.elapsedPct ?? null}
          footer={
            current
              ? [formatDay(current.startDate), formatDay(current.endDate)]
                  .filter(Boolean)
                  .join(' – ') || undefined
              : 'Nothing is being taught today'
          }
        />
        <StatusCard
          label="Terms completed"
          value={`${termProgress.completedCount} of ${termProgress.totalCount}`}
          footer={rangeLabel}
        />
        <StatusCard
          label="Grading sheets locked"
          value={`${overview.sheets.locked} of ${overview.sheets.total}`}
          footer={`${overview.sheets.total - overview.sheets.locked} still open`}
        />
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Figures cover {rangeLabel}. A term still being taught is left out
          until enough of the school has been marked, so it never drags the
          totals.
        </span>
      </p>

      {/* The school this year */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          The school this year
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Students"
            value={scale.studentsEnrolled.toLocaleString('en-SG')}
            footer="Enrolled"
            icon={Users}
          />
          <StatTile
            label="Classes"
            value={String(scale.sections)}
            footer={`Across ${scale.levels} grade levels`}
            icon={School}
          />
          <StatTile
            label="Subjects"
            value={String(scale.subjectsTaught)}
            footer={`Being taught · ${scale.subjectsConfigured} set up`}
            icon={BookOpen}
          />
        </div>
      </section>

      {/* How they are doing */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          How they are doing · {rangeLabel}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Average grade"
            value={fmt(kpis.average)}
            footer={`Across ${coverage.studentsWithGrades} students with grades`}
            icon={GraduationCap}
          />
          <StatTile
            label="Passing rate"
            value={pct(kpis.passingRate)}
            footer="Grades of 75 and above"
            icon={ListChecks}
          />
          <StatTile
            label="Needs support"
            value={String(kpis.needsSupport)}
            footer={`${fmt(kpis.needsSupportPct)}% · averaging below 75`}
            icon={TrendingDown}
            tone="bad"
          />
          <StatTile
            label="Outstanding"
            value={String(kpis.outstanding)}
            footer={`${fmt(kpis.outstandingPct)}% · averaging 90 and above`}
            icon={TrendingUp}
          />
        </div>
      </section>

      {/* Trend + per-term table */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          cap={rangeLabel}
          title="Average grade over the year"
          scope={scopeLabel}
          icon={LineChart}
        >
          <CardContent className="py-5">
            <TermTrendChart terms={overview.terms} />
          </CardContent>
        </SectionCard>

        <SectionCard
          cap="Per term"
          title="Term performance"
          scope={scopeLabel}
          icon={ListChecks}
          footer={
            <>
              A term still being taught shows a dash rather than an average from
              a handful of students — its graded count is still listed.
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Term</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Passing</TableHead>
                <TableHead className="text-right">Students graded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.terms.map((term) => (
                <TableRow
                  key={term.termId}
                  className="transition-colors hover:bg-accent/40"
                >
                  <TableCell className="font-medium">{term.label}</TableCell>
                  <TableCell>
                    <StatusBadge status={term.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(term.average)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(term.passingRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {term.studentsGraded}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell>Year to date</TableCell>
                <TableCell className="font-normal text-muted-foreground">
                  {rangeLabel}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(kpis.average)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(kpis.passingRate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {coverage.studentsWithGrades}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </SectionCard>
      </div>

      {/* The level ladder */}
      {showLevelLadder && (
        <section className="flex flex-col gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {overview.levels[0]?.levelLabel ?? ''} →{' '}
              {overview.levels[overview.levels.length - 1]?.levelLabel ?? ''} ·{' '}
              {rangeLabel}
            </p>
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Performance by grade level
              {scopeLabel ? (
                <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                  ({scopeLabel})
                </span>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              Listed in school order, not ranked — sort by Grade level to put it
              back. Select a grade level to open its full masterfile, or a
              spread bar for the band-by-band breakdown.
            </p>
          </div>
          <OverviewLevelTable rows={levelRows} />
          <p className="text-xs text-muted-foreground">
            “Subjects below 75” is the average number of subjects a student in
            that level is failing. “Below {AT_RISK_ATTENDANCE_THRESHOLD_PCT}%”
            counts students, not days — they are named further down the page.
          </p>
        </section>
      )}

      {/* Attendance */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Attendance · {rangeLabel}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="Average attendance"
            value={pct1(attendance.presentRate)}
            footer={attendanceMovement(attendance.terms)}
            icon={CalendarCheck2}
          />
          <StatTile
            label={`Below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}%`}
            value={
              attendance.studentsRecorded === 0
                ? DASH
                : String(attendance.concerns.length)
            }
            footer={
              attendance.studentsRecorded === 0
                ? 'No register recorded yet'
                : `Of ${attendance.studentsRecorded} students with a register`
            }
            icon={CalendarX2}
            tone="bad"
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          cap={`Across ${termProgress.totalCount} terms`}
          title="Attendance over the year"
          scope={scopeLabel}
          icon={LineChart}
          footer={
            <>
              The {AT_RISK_ATTENDANCE_THRESHOLD_PCT}% line is a reading aid, not
              a school rule — HFSE&rsquo;s own attendance requirement lives in
              the Student Handbook.
            </>
          }
        >
          <CardContent className="py-5">
            {attendance.terms.every((term) => term.rate == null) ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No attendance recorded for this scope yet.
              </p>
            ) : (
              <AttendanceTrendChart terms={attendance.terms} />
            )}
          </CardContent>
        </SectionCard>

        <SectionCard
          cap={`Days attended · ${rangeLabel}`}
          title="How the days split"
          scope={scopeLabel}
          icon={CalendarCheck2}
          footer={
            attendance.ignoresSubjectFilter ? (
              <>
                Attendance is recorded per day, not per subject, so the subject
                filter does not apply here — these are all the days for
                {overview.filters.levelId || overview.filters.sectionId
                  ? ' this cohort'
                  : ' the whole school'}
                .
              </>
            ) : (
              <>
                A late day and an excused day both still count as days present,
                so the {pct1(attendance.presentRate)} attendance figure above is
                on time plus late plus excused. These four do not overlap — they
                add to exactly the days recorded. Excused means an MC or an
                approved absence; Absent means no reason was recorded.
              </>
            )
          }
        >
          <CardContent className="py-6">
            {attendance.schoolDays === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No attendance recorded for this scope yet.
              </p>
            ) : (
              <div className="space-y-5">
                {/* Four, not three, and not Present / Late / Absent.
                    `days_present` swallows BOTH late and excused (migration
                    014 counts P, L and EX alike), so those overlap and cannot
                    be the parts of one ring. These four add to exactly the
                    days recorded and match the ring segment for segment. The
                    headline Present % is the ring's centre.

                    Excused earns its own slice on the numbers: measured on
                    production, 824 excused days against 822 absent — half of
                    all non-attendance is authorised, and folding it into "on
                    time" hid the larger half. */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <StatTile
                    label="On time"
                    value={pct1(dayRate(attendance.onTime, attendance))}
                    footer={`${attendance.onTime.toLocaleString('en-SG')} days`}
                    icon={CircleCheck}
                  />
                  <StatTile
                    label="Late"
                    value={pct1(attendance.lateRate)}
                    footer={`${attendance.late.toLocaleString('en-SG')} days`}
                    icon={Clock}
                  />
                  <StatTile
                    label="Excused"
                    value={pct1(dayRate(attendance.excused, attendance))}
                    footer={`${attendance.excused.toLocaleString('en-SG')} days · MC or approved`}
                    icon={FileCheck2}
                  />
                  <StatTile
                    label="Absent"
                    value={pct1(attendance.absentRate)}
                    footer={`${attendance.absent.toLocaleString('en-SG')} days · no reason recorded`}
                    icon={CircleX}
                    tone="bad"
                  />
                </div>
                <DonutChart
                  data={[
                    { name: 'On time', value: attendance.onTime },
                    { name: 'Late', value: attendance.late },
                    { name: 'Excused', value: attendance.excused },
                    { name: 'Absent', value: attendance.absent },
                  ]}
                  colors={[
                    'var(--color-brand-mint)',
                    'var(--color-brand-amber)',
                    'var(--color-brand-sky)',
                    'var(--destructive)',
                  ]}
                  height={190}
                  centerValue={pct1(attendance.presentRate)}
                  centerLabel="Present"
                />
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {attendance.schoolDays.toLocaleString('en-SG')} student-days
                  recorded
                </p>
              </div>
            )}
          </CardContent>
        </SectionCard>
      </div>

      {/* Who is under the line. Named at every scope, unlike the academic
          lists — a short, explicitly-bounded list the office has to act on,
          rather than an unbounded watchlist. See the comment on
          `AttendanceHealth.concerns`. */}
      {attendance.studentsRecorded > 0 && (
        <SectionCard
          cap={`${rangeLabel} · ${attendance.concerns.length} of ${attendance.studentsRecorded}`}
          title={`Students below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% attendance`}
          scope={scopeLabel}
          icon={Users}
          footer={
            <>
              Counted across every term reported above, not term by term, so a
              student who missed one stretch and has been in since is measured
              on the whole year. Nothing here is recorded against the student.
            </>
          }
        >
          {attendance.concerns.length === 0 ? (
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Every student with a register is at{' '}
              {AT_RISK_ATTENDANCE_THRESHOLD_PCT}% or above.
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Student</TableHead>
                    <TableHead>Grade level</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">Days missed</TableHead>
                    <TableHead className="text-right">School days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.concerns.map((student) => (
                    <TableRow
                      key={student.studentId}
                      className="transition-colors hover:bg-accent/40"
                    >
                      <TableCell className="font-medium">
                        {student.fullName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {student.levelLabel || DASH}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {student.sectionName || DASH}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {pct1(student.rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {student.daysMissed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {student.schoolDays}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Spread + what to look at */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          cap={`${distribution.total} students with grades`}
          title="How the school is spread"
          scope={scopeLabel}
          icon={PieChart}
          footer={
            <>
              The same five colours run through every spread bar above — those
              bars add up to exactly this circle.
            </>
          }
        >
          <CardContent className="py-6">
            <BandDonut bands={distribution.bands} />
          </CardContent>
        </SectionCard>

        <SectionCard
          cap={rangeLabel}
          title="Worth a look"
          scope={scopeLabel}
          icon={ListChecks}
          footer={
            <>
              Each line restates a figure from this page — nothing here is a
              judgement the system made on its own.
            </>
          }
        >
          <CardContent className="py-5">
            {highlights.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing stands out yet. Once a term is marked, the weakest year
                group and the subjects slipping behind appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {highlights.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 size-2 shrink-0 rounded-sm ${SEVERITY_DOT[item.severity]}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">
                        {item.title}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </SectionCard>
      </div>

      {/* Subjects */}
      <section className="flex flex-col gap-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Examinable subjects · {rangeLabel}
          </p>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Performance by subject
            {scopeLabel ? (
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                ({scopeLabel})
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Listed by how many students take it — sort by Students to put it
            back. Select a spread bar for the band-by-band breakdown.
          </p>
        </div>
        <OverviewSubjectTable rows={overview.subjects} />
        <p className="text-xs text-muted-foreground">
          Examinable subjects only — the rest are graded by letter and are not
          averaged here. “Passing” counts individual marks, while the spread bar
          counts students by their average in that subject, so a subject can
          pass most marks and still leave a group behind.
        </p>
      </section>

      {students && (
        <div className="grid gap-5 lg:grid-cols-2">
          <SectionCard
            cap={`${rangeLabel} · top 5`}
            title="Top performing students"
            scope={scopeLabel}
            icon={TrendingUp}
          >
            {students.top.length === 0 ? (
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No grades recorded for this class yet.
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Subjects</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.top.map((student, i) => (
                    <TableRow
                      key={student.studentId}
                      className="transition-colors hover:bg-accent/40"
                    >
                      <TableCell className="tabular-nums text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {student.fullName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {student.average.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {student.subjectsTaken}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct1(student.attendanceRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard
            cap={`${rangeLabel} · averaging below 75`}
            title="Students needing support"
            scope={scopeLabel}
            icon={TrendingDown}
            footer={
              <>
                Listed because their average is below the pass mark — the same
                75 used everywhere on this page. It is not a judgement about the
                student, and nothing here is recorded against them.
              </>
            }
          >
            {students.needsImprovement.length === 0 ? (
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Every student in this class is averaging 75 or above.
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">
                      Subjects below 75
                    </TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.needsImprovement.map((student) => (
                    <TableRow
                      key={student.studentId}
                      className="transition-colors hover:bg-accent/40"
                    >
                      <TableCell className="font-medium">
                        {student.fullName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">
                        {student.average.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {student.subjectsBelowPass} of {student.subjectsTaken}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct1(student.attendanceRate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      )}

      {anomalies.impossibleLowGrades > 0 && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <Info className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              {anomalies.impossibleLowGrades} grades are stored below 60
            </p>
            <p className="text-sm text-muted-foreground">
              The grading formula cannot produce a mark under 60, so these were
              entered another way. They pull down every average and passing rate
              on this page. Worth checking with whoever loaded this year&rsquo;s
              grades.
            </p>
          </div>
        </div>
      )}

      {/* Quick links — the §8 interactive quick-link card pattern, same as the
          per-level dashboard's "Go deeper". Each carries the CURRENT filter, so
          you land on the same cohort you were just looking at. */}
      <section className="space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Quick links
          </p>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Go deeper
          </h2>
          <p className="text-sm text-muted-foreground">
            Jump to a focused view
            {scopeLabel ? `, still scoped to ${scopeLabel}` : ''}.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink
            eyebrow="Grading"
            title="Grading sheets"
            description="Enter and lock marks, and see which sheets are still open."
            href={`/markbook/grading${scopeQuery}`}
            icon={ClipboardList}
          />
          <QuickLink
            eyebrow="Attendance"
            title="Attendance records"
            description="Per-term present, late and absent totals for this cohort."
            href={`/attendance/summary${scopeQuery}`}
            icon={CalendarCheck2}
          />
          <QuickLink
            eyebrow="Awards"
            title="Academic awards"
            description="Gold, Silver and Bronze recipients by subject and overall."
            href={`/markbook/awards${scopeQuery}`}
            icon={Award}
          />
          <QuickLink
            eyebrow="Comments"
            title="Adviser comments"
            description="Which form class advisers have written up, and who has not."
            href={`/evaluation/comments${scopeQuery}`}
            icon={MessageSquareText}
          />
        </div>
      </section>

      <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {coverage.enrolledWithoutGrades} of {coverage.studentsEnrolled} enrolled
        students have no grades yet · Passing = 75 and above · {overview.ayCode}
        {termProgress.reportedRangeLabel
          ? ` · ${termProgress.reportedRangeLabel}`
          : ''}
      </p>
    </div>
  );
}
