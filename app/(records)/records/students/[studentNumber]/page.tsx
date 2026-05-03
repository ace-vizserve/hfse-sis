import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BadgePercent,
  Bus,
  CalendarCheck,
  Check,
  ClipboardList,
  CreditCard,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  Home,
  Layers,
  Mail,
  Phone,
  Pill,
  ShieldCheck,
  Shirt,
  Sparkles,
  Stethoscope,
  User,
  UserCircle2,
  Users,
  Utensils,
  X,
} from 'lucide-react';

import { StageStatusBadge } from '@/components/sis/status-badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  findStudentByNumber,
  getAcademicHistory,
  getAttendanceHistory,
  getPlacementHistory,
  type AcademicHistoryRow,
  type AttendanceHistoryRow,
  type PlacementRow,
} from '@/lib/sis/records-history';
import {
  getEnrollmentHistory,
  getStudentDetail,
  type ApplicationRow,
  type StatusRow,
} from '@/lib/sis/queries';
import { getStudentLifecycle } from '@/lib/sis/process';
import {
  getSectionTransfersForStudent,
  type SectionTransferEntry,
} from '@/lib/sis/section-history';
import { preloadTermsForAYs, termForDateInPreloaded } from '@/lib/sis/terms';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { CompassionateAllowanceInline } from '@/components/sis/compassionate-allowance-inline';
import { StpApplicationCard } from '@/components/sis/stp-application-card';
import { StudentLifecycleTimeline } from '@/components/sis/student-lifecycle-timeline';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';

// Canonical CardAction gradient tile — indigo→navy with brand-tile glow.
// Used as the top-right icon affordance on every Card across the page so the
// section reads as a destination, not a flat block of text.
function ActionTile({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  );
}

// Resolve a historical AY code into a deep link to that AY's admissions
// detail page (with the enrollment tab pre-selected). Falls through to plain
// text when the student has no admissions row for that AY — e.g. pre-SIS
// legacy years that only exist in the grading schema.
function AyLink({
  ayCode,
  enroleeByAy,
  className,
  children,
}: {
  ayCode: string;
  enroleeByAy: Map<string, string>;
  className?: string;
  children?: React.ReactNode;
}) {
  const enroleeNumber = enroleeByAy.get(ayCode);
  const label = children ?? ayCode;
  if (!enroleeNumber) return <span className={className}>{label}</span>;
  return (
    <Link
      href={`/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`}
      className={`underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40 ${className ?? ''}`}
    >
      {label}
    </Link>
  );
}

function displayName(s: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string {
  const parts = [s.lastName, s.firstName, s.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : '(no name on file)';
}

function fmtPercentage(num: number | null, den: number | null): string {
  if (!num || !den || den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

const TAB_KEYS = ['overview', 'family', 'placements', 'academic', 'lifecycle'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function RecordsStudentCrossYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { studentNumber } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'overview';

  const student = await findStudentByNumber(studentNumber);
  if (!student) {
    // Legacy data path: the admissions tables may have a row with this
    // studentNumber even though public.students doesn't (pre-SIS legacy
    // data that was never synced into the grading schema). If we can find
    // any admissions history for the studentNumber, redirect to the most
    // recent AY's admissions detail instead of 404ing — the user still
    // gets a useful surface, just without the cross-year grading overlay.
    const history = await getEnrollmentHistory(studentNumber);
    if (history.length > 0) {
      // getEnrollmentHistory returns per-AY; pick the newest AY by ay_code
      // (string sort works because ay_code is AY2026 / AY2025 / etc).
      const newest = [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode))[0];
      redirect(
        `/admissions/applications/${encodeURIComponent(newest.enroleeNumber)}?ay=${encodeURIComponent(newest.ayCode)}`,
      );
    }
    notFound();
  }

  const [placements, academics, attendance, history, currentAy] = await Promise.all([
    getPlacementHistory(student.studentId),
    getAcademicHistory(student.studentId),
    getAttendanceHistory(student.studentId),
    getEnrollmentHistory(studentNumber),
    getCurrentAcademicYear(),
  ]);

  // Section transfers — audit-log-derived intra-AY moves between sections.
  // Keyed off every AY's enroleeNumber for this student so cross-year
  // history surfaces too.
  const sectionTransfers = await getSectionTransfersForStudent(
    studentNumber,
    history.map((h) => h.enroleeNumber),
  );

  // Preload terms for every AY in the placement list so the placement table
  // can derive the joining term for late enrollees in one shot (each
  // placement is a different AY; one round-trip vs N).
  const placementAyCodes = Array.from(new Set(placements.map((p) => p.ayCode)));
  const termsByAy = await preloadTermsForAYs(placementAyCodes);

  // ayCode → enroleeNumber lookup so AY references in the historical tables
  // can deep-link to the admissions detail page for that specific AY. Empty
  // map when this student has no admissions rows at all (legacy-only path).
  const enroleeByAy = new Map<string, string>(
    history.map((h) => [h.ayCode, h.enroleeNumber] as const),
  );

  const ayCount = new Set(placements.map((p) => p.ayCode)).size;
  const activePlacement = placements.find((p) => p.enrollmentStatus === 'active');

  // Resolve the (ayCode, enroleeNumber) pair for the lifecycle snapshot.
  // Prefer the current-AY entry; fall back to the most recent prior AY when
  // the student is only in legacy years; skip rendering altogether when no
  // admissions row exists for this studentNumber at all.
  const lifecycleEntry = (() => {
    if (history.length === 0) return null;
    if (currentAy) {
      const match = history.find((h) => h.ayCode === currentAy.ay_code);
      if (match) return match;
    }
    return [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode))[0];
  })();

  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the page reads them. Cached 60s; existing PATCH routes invalidate via
  // the sis:${ayCode} tag.
  if (lifecycleEntry) {
    await freshenAyDocuments(lifecycleEntry.ayCode);
  }

  // Compassionate-leave allowance lookup. The editor lives in the
  // Attendance section card header; the PATCH route keys by the current-
  // AY enroleeNumber so we resolve that pair here. Records detail is
  // enrolled-only by route gate (KD #51), so no disabled-state branch
  // is needed beyond "no current-AY admissions row" (legacy edge case).
  const allowanceService = createServiceClient();
  const { data: allowanceRow } = await allowanceService
    .from('students')
    .select('urgent_compassionate_allowance')
    .eq('id', student.studentId)
    .maybeSingle();
  const allowance =
    (allowanceRow as { urgent_compassionate_allowance: number | null } | null)
      ?.urgent_compassionate_allowance ?? 5;
  const currentEnroleeNumber = currentAy
    ? history.find((h) => h.ayCode === currentAy.ay_code)?.enroleeNumber ?? null
    : null;

  const lifecycleSnapshot = lifecycleEntry
    ? await getStudentLifecycle(lifecycleEntry.ayCode, lifecycleEntry.enroleeNumber)
    : null;

  // Current-AY admissions detail — the (application, status, documents)
  // triple. Powers the post-enrolment checklist + family/services/medical
  // cards below, and the conditional STP application card. STP visibility is
  // gated on `application.stpApplicationType IS NOT NULL` per the admissions
  // detail page.
  const currentAyDetail = lifecycleEntry
    ? await getStudentDetail(lifecycleEntry.ayCode, lifecycleEntry.enroleeNumber)
    : null;

  return (
    <PageShell>
      <Link
        href="/records/students"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Students
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Permanent record
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {displayName(student)}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            #{student.studentNumber}
          </Badge>
        </div>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Cross-year view keyed on <code className="font-mono">studentNumber</code> (Hard Rule #4).{' '}
          {ayCount > 0 ? (
            <>
              Enrolled across <strong>{ayCount}</strong> academic year{ayCount === 1 ? '' : 's'}.
              {activePlacement && (
                <>
                  {' '}Currently in{' '}
                  <strong>
                    {activePlacement.levelCode} {activePlacement.sectionName}
                  </strong>
                  .
                </>
              )}
            </>
          ) : (
            <>No enrolment history yet.</>
          )}
        </p>
      </header>

      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <Stat label="Academic years" value={ayCount} icon={Layers} footnote="Years on roster" />
          <Stat
            label="Total placements"
            value={placements.length}
            icon={Users}
            footnote="Section enrolments"
          />
          <Stat
            label="Terms graded"
            value={academics.reduce((n, ay) => n + ay.terms.length, 0)}
            icon={GraduationCap}
            footnote="Cumulative across years"
          />
        </div>
      </section>

      {currentAyDetail && (
        <QuickActionsStrip
          enroleeNumber={currentAyDetail.application.enroleeNumber}
          ayCode={currentAyDetail.ayCode}
          studentId={student.studentId}
          studentNumber={studentNumber}
        />
      )}

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="family">Family &amp; care</TabsTrigger>
          <TabsTrigger value="placements">Placements</TabsTrigger>
          <TabsTrigger value="academic">Academic</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {currentAyDetail ? (
            <PostEnrolmentChecklist
              status={currentAyDetail.status}
              ayCode={currentAyDetail.ayCode}
              enroleeNumber={currentAyDetail.application.enroleeNumber}
            />
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No current-AY admissions row for this student.
                </p>
              </CardContent>
            </Card>
          )}
          {currentAyDetail?.application.stpApplicationType && (
            <StpApplicationCard
              application={currentAyDetail.application}
              documents={currentAyDetail.documents}
              ayCode={currentAyDetail.ayCode}
            />
          )}
        </TabsContent>

        <TabsContent value="family" className="space-y-6">
          {currentAyDetail ? (
            <>
              <FamilyContactCard app={currentAyDetail.application} />
              <ServicePreferencesCard
                app={currentAyDetail.application}
                status={currentAyDetail.status}
              />
              <MedicalCard app={currentAyDetail.application} />
            </>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  Family, services, and medical info live on the current-AY admissions row.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="placements" className="space-y-6">
          <PlacementSection rows={placements} termsByAy={termsByAy} enroleeByAy={enroleeByAy} />
          <SectionTransferSection rows={sectionTransfers} enroleeByAy={enroleeByAy} />
        </TabsContent>

        <TabsContent value="academic" className="space-y-6">
          <AcademicSection rows={academics} enroleeByAy={enroleeByAy} />
          <AttendanceSection
            rows={attendance}
            enroleeByAy={enroleeByAy}
            studentNumber={studentNumber}
            allowance={allowance}
            currentEnroleeNumber={currentEnroleeNumber}
          />
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-6">
          {lifecycleSnapshot ? (
            <StudentLifecycleTimeline snapshot={lifecycleSnapshot} history={history} />
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No lifecycle snapshot available — this student has no admissions row in the current AY.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <GraduationCap className="size-3" strokeWidth={2.25} />
        <span>Permanent record</span>
        <span className="text-border">·</span>
        <span>studentNumber {student.studentNumber}</span>
        <span className="text-border">·</span>
        <span>Append-only</span>
      </div>
    </PageShell>
  );
}

function Stat({
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
    <div
      data-slot="card"
      className="@container/card flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm"
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-6">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</p>
          <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
            {value.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="px-6 text-xs text-muted-foreground">{footnote}</p>
    </div>
  );
}

function PlacementSection({
  rows,
  termsByAy,
  enroleeByAy,
}: {
  rows: PlacementRow[];
  termsByAy: Map<string, Array<{ termNumber: number; startDate: string; endDate: string }>>;
  enroleeByAy: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Class placement history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Placements across every AY
        </CardTitle>
        <CardAction>
          <ActionTile icon={Layers} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No placements on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3">AY</th>
                  <th className="py-2 pr-3">Level</th>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3 text-right">Index</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Enrolled</th>
                  <th className="py-2 pr-3">Withdrawn</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Late enrollees: derive the joining term from the
                  // enrollment_date (which the PATCH route refreshes to
                  // today on the active → late_enrollee transition). Non-
                  // late rows skip the lookup.
                  const lateTerm =
                    r.enrollmentStatus === 'late_enrollee' && r.enrollmentDate
                      ? termForDateInPreloaded(r.enrollmentDate, r.ayCode, termsByAy)
                      : null;
                  return (
                    <tr
                      key={`${r.ayCode}-${r.sectionName}-${r.indexNumber}`}
                      className="border-b border-hairline last:border-0"
                    >
                      <td className="py-2 pr-3 font-mono tabular-nums">
                        <AyLink ayCode={r.ayCode} enroleeByAy={enroleeByAy} />
                      </td>
                      <td className="py-2 pr-3">{r.levelCode}</td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/markbook/sections/${r.sectionId}`}
                          className="text-foreground underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                        >
                          {r.sectionName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        #{r.indexNumber}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusBadge status={r.enrollmentStatus} />
                          {lateTerm && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-amber">
                              · {lateTerm.termLabel}
                            </span>
                          )}
                          {r.enrollmentStatus === 'late_enrollee' && !lateTerm && r.enrollmentDate && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              · between terms
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {r.enrollmentDate ?? '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {r.withdrawalDate ?? '—'}
                      </td>
                      <td className="py-2">
                        {r.enrollmentStatus !== 'withdrawn' && (
                          <Link
                            href={`/sis/sections/${r.sectionId}`}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ArrowRightLeft className="size-3" />
                            Move
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PlacementRow['enrollmentStatus'] }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'late_enrollee') return <Badge variant="warning">Late</Badge>;
  return <Badge variant="muted">Withdrawn</Badge>;
}

function SectionTransferSection({
  rows,
  enroleeByAy,
}: {
  rows: SectionTransferEntry[];
  enroleeByAy: Map<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Section transfers
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Mid-year section moves
        </CardTitle>
        <CardAction>
          <ActionTile icon={ArrowRightLeft} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1.5 rounded-xl bg-muted/25 px-4 py-3 ring-1 ring-inset ring-border sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-serif text-[15px] text-foreground">
                  <span>{r.fromSection || '—'}</span>
                  <ArrowRightLeft className="size-3.5 text-brand-indigo" />
                  <span>{r.toSection || '—'}</span>
                  {r.ayCode ? (
                    <AyLink
                      ayCode={r.ayCode}
                      enroleeByAy={enroleeByAy}
                      className="ml-1 inline-flex h-5 items-center rounded-md border border-border bg-muted/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {r.ayCode}
                    </AyLink>
                  ) : (
                    <Badge
                      variant="outline"
                      className="ml-1 h-5 border-border bg-muted/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      —
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {r.transferDate || '—'}
                  <span className="mx-1.5 text-border">·</span>
                  {r.termLabel ?? 'Between terms'}
                  {r.actorEmail && (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span>
                        by{' '}
                        <a
                          href={`mailto:${r.actorEmail}`}
                          className="lowercase underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                        >
                          {r.actorEmail}
                        </a>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AcademicSection({
  rows,
  enroleeByAy,
}: {
  rows: AcademicHistoryRow[];
  enroleeByAy: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Academic history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Grades per term × subject
        </CardTitle>
        <CardAction>
          <ActionTile icon={GraduationCap} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No graded terms yet.</p>
        ) : (
          rows.map((ay) => (
            <div key={ay.ayCode} className="space-y-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <AyLink ayCode={ay.ayCode} enroleeByAy={enroleeByAy}>
                  {ay.ayCode} · {ay.ayLabel}
                </AyLink>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Subject</th>
                      {ay.terms.map((t) => (
                        <th key={t.termNumber} className="py-2 pr-3 text-right">
                          T{t.termNumber}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Collect the union of subjects across all terms in this AY.
                      const subjMap = new Map<string, string>();
                      for (const t of ay.terms) {
                        for (const s of t.subjects) {
                          if (!subjMap.has(s.subjectCode)) {
                            subjMap.set(s.subjectCode, s.subjectName);
                          }
                        }
                      }
                      const subjects = [...subjMap.entries()].sort((a, b) =>
                        a[1].localeCompare(b[1]),
                      );
                      return subjects.map(([code, name]) => (
                        <tr key={code} className="border-b border-hairline last:border-0">
                          <td className="py-2 pr-3 font-medium text-foreground">{name}</td>
                          {ay.terms.map((t) => {
                            const cell = t.subjects.find((s) => s.subjectCode === code);
                            return (
                              <td
                                key={t.termNumber}
                                className="py-2 pr-3 text-right font-mono tabular-nums"
                              >
                                {cell?.quarterlyGrade != null
                                  ? cell.quarterlyGrade.toFixed(0)
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceSection({
  rows,
  enroleeByAy,
  studentNumber,
  allowance,
  currentEnroleeNumber,
}: {
  rows: AttendanceHistoryRow[];
  enroleeByAy: Map<string, string>;
  studentNumber: string;
  allowance: number;
  currentEnroleeNumber: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Attendance history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Per-term summary
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/attendance/students/${encodeURIComponent(studentNumber)}`}>
              Open daily detail
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
          <ActionTile icon={CalendarCheck} />
        </CardAction>
      </CardHeader>
      <div className="border-b border-hairline px-6 pb-4">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Compassionate-leave quota
        </p>
        <CompassionateAllowanceInline
          enroleeNumber={currentEnroleeNumber ?? ''}
          initial={allowance}
          disabled={!currentEnroleeNumber}
          disabledReason={
            !currentEnroleeNumber
              ? 'No current-AY admissions record for this student.'
              : undefined
          }
        />
      </div>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records yet.</p>
        ) : (
          rows.map((ay) => (
            <div key={ay.ayCode} className="space-y-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <AyLink ayCode={ay.ayCode} enroleeByAy={enroleeByAy}>
                  {ay.ayCode} · {ay.ayLabel}
                </AyLink>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Term</th>
                      <th className="py-2 pr-3 text-right">School days</th>
                      <th className="py-2 pr-3 text-right">Present</th>
                      <th className="py-2 pr-3 text-right">Late</th>
                      <th className="py-2 text-right">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ay.terms.map((t) => (
                      <tr key={t.termNumber} className="border-b border-hairline last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">T{t.termNumber}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.schoolDays ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysPresent ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysLate ?? '—'}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {fmtPercentage(t.daysPresent, t.schoolDays)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Quick actions — three cross-module deep links so the admin can jump from
// "I'm looking at this record" to "I'm editing the enrolment record / chasing
// docs / browsing the student's audit trail" without navigating manually.
// The admissions link is the canonical edit surface for post-enrolment
// stages (KD #51 — Records is read-only, edits live on /admissions/*).
// ──────────────────────────────────────────────────────────────────────────

function QuickActionsStrip({
  enroleeNumber,
  ayCode,
  studentId,
  studentNumber,
}: {
  enroleeNumber: string;
  ayCode: string;
  /** UUID from `public.students.id` — drives the Markbook report-card link. */
  studentId: string;
  /** Stable cross-AY ID per Hard Rule #4 — drives the Attendance per-student link. */
  studentNumber: string;
}) {
  const actions: Array<{
    href: string;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      href: `/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`,
      label: 'Open enrolment record',
      sublabel: `Edit post-enrolment stages · ${ayCode}`,
      icon: ExternalLink,
    },
    {
      href: `/p-files/${enroleeNumber}`,
      label: 'P-Files',
      sublabel: 'Documents · renewals',
      icon: FolderOpen,
    },
    {
      href: `/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=family`,
      label: 'Family details',
      sublabel: 'Edit parents + guardian',
      icon: Users,
    },
    {
      href: `/markbook/report-cards/${studentId}`,
      label: 'Markbook',
      sublabel: 'Report card · per term',
      icon: GraduationCap,
    },
    {
      href: `/attendance/students/${encodeURIComponent(studentNumber)}`,
      label: 'Attendance',
      sublabel: 'Daily ledger · quota',
      icon: CalendarCheck,
    },
  ];
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-xl border border-border bg-gradient-to-t from-primary/5 to-card px-4 py-3 shadow-xs transition-all hover:border-brand-indigo/40 hover:shadow-brand-tile/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[14px] font-semibold leading-tight tracking-tight text-foreground">
                {a.label}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {a.sublabel}
              </p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Post-enrolment checklist — operational stages from `ay{YY}_enrolment_status`
// in pipeline order. Read-only on Records (KD #51); CardFooter links to the
// admissions detail page where the registrar actually flips statuses.
// Each row formats one of the eight stages; missing dates render as "—".
// ──────────────────────────────────────────────────────────────────────────

function PostEnrolmentChecklist({
  status,
  ayCode,
  enroleeNumber,
}: {
  status: StatusRow | null;
  ayCode: string;
  enroleeNumber: string;
}) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Post-enrolment checklist · {ayCode}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            What still needs to be done
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No status row on file for this AY.</p>
        </CardContent>
      </Card>
    );
  }

  const stages: Array<{
    label: string;
    status: string | null;
    sublabel?: string | null;
    updated: string | null;
    updatedBy: string | null;
  }> = [
    {
      label: 'Registration',
      status: status.registrationStatus,
      sublabel: status.registrationPaymentDate
        ? `Paid ${formatShort(status.registrationPaymentDate)}`
        : status.registrationInvoice
          ? `Invoice ${status.registrationInvoice}`
          : null,
      updated: status.registrationUpdatedDate,
      updatedBy: status.registrationUpdatedBy,
    },
    {
      label: 'Documents',
      status: status.documentStatus,
      sublabel: null,
      updated: status.documentUpdatedDate,
      updatedBy: status.documentUpdatedBy,
    },
    {
      label: 'Assessment',
      status: status.assessmentStatus,
      sublabel: status.assessmentSchedule
        ? `Scheduled ${formatShort(status.assessmentSchedule)}`
        : null,
      updated: status.assessmentUpdatedDate,
      updatedBy: status.assessmentUpdatedBy,
    },
    {
      label: 'Contract',
      status: status.contractStatus,
      sublabel: null,
      updated: status.contractUpdatedDate,
      updatedBy: status.contractUpdatedBy,
    },
    {
      label: 'Fees',
      status: status.feeStatus,
      sublabel: status.feePaymentDate
        ? `Paid ${formatShort(status.feePaymentDate)}`
        : status.feeStartDate
          ? `Starts ${formatShort(status.feeStartDate)}`
          : status.feeInvoice
            ? `Invoice ${status.feeInvoice}`
            : null,
      updated: status.feeUpdatedDate,
      updatedBy: status.feeUpdatedBy,
    },
    {
      label: 'Class assignment',
      status: status.classStatus,
      sublabel: [status.classLevel, status.classSection].filter(Boolean).join(' · ') || null,
      updated: status.classUpdatedDate,
      updatedBy: status.classUpdatedBy,
    },
    {
      label: 'Supplies',
      status: status.suppliesStatus,
      sublabel: status.suppliesClaimedDate
        ? `Claimed ${formatShort(status.suppliesClaimedDate)}`
        : null,
      updated: status.suppliesUpdatedDate,
      updatedBy: status.suppliesUpdatedBy,
    },
    {
      label: 'Orientation',
      status: status.orientationStatus,
      sublabel: status.orientationScheduleDate
        ? `Scheduled ${formatShort(status.orientationScheduleDate)}`
        : null,
      updated: status.orientationUpdatedDate,
      updatedBy: status.orientationUpdatedBy,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Post-enrolment checklist · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          What still needs to be done
        </CardTitle>
        <CardAction>
          <ActionTile icon={ClipboardList} />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-hairline">
          {stages.map((s) => (
            <li
              key={s.label}
              className="relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1 ${stageStripeClass(s.status)}`}
              />
              <div className="min-w-0 flex-1 pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-sm font-semibold tracking-tight text-foreground">
                    {s.label}
                  </h3>
                  <StageStatusBadge status={s.status} />
                </div>
                {(s.sublabel || s.updated || s.updatedBy) && (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                    {[s.sublabel, s.updated ? formatShort(s.updated) : null]
                      .filter(Boolean)
                      .join(' · ')}
                    {s.updatedBy && (
                      <>
                        {(s.sublabel || s.updated) && <span className="mx-1">·</span>}
                        by{' '}
                        <a
                          href={`mailto:${s.updatedBy}`}
                          className="lowercase underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                        >
                          {s.updatedBy}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="border-t border-hairline bg-muted/20">
        <Button asChild variant="outline" size="sm">
          <Link href={`/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`}>
            <ExternalLink className="h-3.5 w-3.5" />
            Edit in admissions
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Stripe color keyed off the same semantic mapping as <StageStatusBadge> — see
// `components/sis/status-badge.tsx::STAGE_VARIANT`. Keeps the visual language
// consistent across this checklist and the admissions EnrollmentTab.
function stageStripeClass(status: string | null): string {
  const t = (status ?? '').trim();
  if (!t) return 'bg-muted-foreground/30';
  if (
    t === 'Finished' ||
    t === 'Signed' ||
    t === 'Valid' ||
    t === 'Verified' ||
    t === 'Paid' ||
    t === 'Claimed'
  ) {
    return 'bg-brand-mint';
  }
  if (
    t === 'Pending' ||
    t === 'Incomplete' ||
    t === 'Uploaded' ||
    t === 'To follow' ||
    t === 'Unpaid'
  ) {
    return 'bg-brand-amber';
  }
  if (t === 'Rejected' || t === 'Expired') return 'bg-destructive';
  if (t === 'Cancelled' || t === 'Withdrawn') return 'bg-muted-foreground/30';
  return 'bg-brand-indigo';
}

function formatShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ──────────────────────────────────────────────────────────────────────────
// Family contact — mother / father / guardian columns. Each parent block is
// rendered only when at least one field is populated; mailto: + tel: links so
// the registrar can reach out without leaving the page. Home address /
// postal / home phone trail underneath.
// ──────────────────────────────────────────────────────────────────────────

function FamilyContactCard({ app }: { app: ApplicationRow }) {
  const blocks: Array<{
    role: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    nationality: string | null;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      role: 'Mother',
      name: app.motherFullName,
      email: app.motherEmail,
      mobile: app.motherMobile,
      nationality: app.motherNationality,
      icon: User,
    },
    {
      role: 'Father',
      name: app.fatherFullName,
      email: app.fatherEmail,
      mobile: app.fatherMobile,
      nationality: app.fatherNationality,
      icon: User,
    },
    {
      role: 'Guardian',
      name: app.guardianFullName,
      email: app.guardianEmail,
      mobile: app.guardianMobile,
      nationality: app.guardianNationality,
      icon: ShieldCheck,
    },
  ];
  const visibleBlocks = blocks.filter((b) => b.name || b.email || b.mobile);
  const hasHome = app.homePhone || app.homeAddress || app.postalCode;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Family · contact
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Reach out
        </CardTitle>
        <CardAction>
          <ActionTile icon={Users} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {visibleBlocks.length === 0 && !hasHome ? (
          <p className="text-sm text-muted-foreground">No family contact on file.</p>
        ) : (
          <>
            {visibleBlocks.length > 0 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {visibleBlocks.map((b) => {
                  const Icon = b.icon;
                  return (
                    <div
                      key={b.role}
                      className="rounded-xl bg-gradient-to-t from-primary/5 to-card p-4 ring-1 ring-inset ring-border shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {b.role}
                          </p>
                          {b.name && (
                            <p className="font-serif text-[14px] font-semibold leading-tight text-foreground">
                              {b.name}
                            </p>
                          )}
                        </div>
                      </div>
                      {b.nationality && (
                        <div className="mt-3">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.12em]">
                            {b.nationality}
                          </Badge>
                        </div>
                      )}
                      {(b.email || b.mobile) && (
                        <div className="mt-3 space-y-1.5 border-t border-hairline pt-3">
                          {b.email && <ContactPill href={`mailto:${b.email}`} icon={Mail} value={b.email} />}
                          {b.mobile && (
                            <ContactPill href={`tel:${b.mobile}`} icon={Phone} value={b.mobile} mono />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {hasHome && (
              <div className="rounded-xl bg-muted/25 p-4 ring-1 ring-inset ring-border">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Home className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Home
                    </p>
                    {app.homeAddress && (
                      <p className="text-[13px] leading-tight text-foreground">{app.homeAddress}</p>
                    )}
                  </div>
                  {app.postalCode && (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums">
                      {app.postalCode}
                    </Badge>
                  )}
                </div>
                {(app.homePhone || app.livingWithWhom) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                    {app.homePhone && (
                      <ContactPill href={`tel:${app.homePhone}`} icon={Phone} value={app.homePhone} mono />
                    )}
                    {app.livingWithWhom && (
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.12em]">
                        Living with · {app.livingWithWhom}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Pill-style mailto:/tel: link — gradient-tinted leading icon + value.
// Visually weighted enough to read as an action without competing with
// Badge primitives. Reuses brand-indigo tones to stay in the indigo band.
function ContactPill({
  href,
  icon: Icon,
  value,
  mono = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  mono?: boolean;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-[13px] text-foreground ring-1 ring-inset ring-border transition-all hover:bg-muted/40 hover:ring-brand-indigo/40 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo/20 to-brand-indigo/5 text-brand-indigo">
        <Icon className="size-3" />
      </span>
      <span className={`min-w-0 truncate ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </a>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Service preferences — bus / student care / uniform are stored as 'Yes'/
// 'No' strings on the apps row (per the existing comment in lib/sis/queries.ts).
// Discounts are open-text codes the registrar applied at admissions time.
// ──────────────────────────────────────────────────────────────────────────

function ServicePreferencesCard({ app, status }: { app: ApplicationRow; status: StatusRow | null }) {
  const services: Array<{
    label: string;
    value: string | null;
    detail: string | null;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { label: 'School bus', value: app.availSchoolBus, detail: null, icon: Bus },
    {
      label: 'Student care',
      value: app.availStudentCare,
      detail: app.studentCareProgram,
      icon: Sparkles,
    },
    { label: 'Uniform', value: app.availUniform, detail: null, icon: Shirt },
  ];
  const discounts = [app.discount1, app.discount2, app.discount3].filter(
    (d): d is string => !!d && d.trim().length > 0,
  );
  const hasAnything =
    services.some((s) => !!s.value) ||
    discounts.length > 0 ||
    !!app.paymentOption ||
    !!status?.enroleeType;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Service preferences
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Services · discounts · billing
        </CardTitle>
        <CardAction>
          <ActionTile icon={Sparkles} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">No service preferences on file.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {services.map((s) => {
                const Icon = s.icon;
                const v = (s.value ?? '').toLowerCase();
                return (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {s.label}
                      </p>
                      {v === 'yes' ? (
                        <Badge variant="success" className="gap-1">
                          <Check className="size-3" />
                          Yes
                        </Badge>
                      ) : v === 'no' ? (
                        <Badge variant="muted" className="gap-1">
                          <X className="size-3" />
                          No
                        </Badge>
                      ) : (
                        <p className="font-mono text-[13px] text-muted-foreground">—</p>
                      )}
                      {v === 'yes' && s.detail && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {s.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {(discounts.length > 0 || app.paymentOption || status?.enroleeType) && (
              <div className="grid grid-cols-1 gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
                {status?.enroleeType && (
                  <BillingTile label="Enrolee type" icon={UserCircle2}>
                    <Badge variant="default">{status.enroleeType}</Badge>
                  </BillingTile>
                )}
                {app.paymentOption && (
                  <BillingTile label="Payment option" icon={CreditCard}>
                    <p className="font-serif text-[14px] font-semibold leading-tight text-foreground">
                      {app.paymentOption}
                    </p>
                  </BillingTile>
                )}
                {discounts.length > 0 && (
                  <BillingTile label="Discounts applied" icon={BadgePercent}>
                    <div className="flex flex-wrap gap-1.5">
                      {discounts.map((d, i) => (
                        <Badge key={`${d}-${i}`} variant="default">
                          {d}
                        </Badge>
                      ))}
                    </div>
                  </BillingTile>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Medical & dietary — flag chips for known conditions, free-text details
// underneath. Surfaced on Records so an admin/registrar with the page open
// has the at-a-glance picture without bouncing to admissions for it.
// ──────────────────────────────────────────────────────────────────────────

function MedicalCard({ app }: { app: ApplicationRow }) {
  const flags: Array<{ label: string; on: boolean }> = [
    { label: 'Asthma', on: !!app.asthma },
    { label: 'Allergies', on: !!app.allergies },
    { label: 'Food allergies', on: !!app.foodAllergies },
    { label: 'Heart condition', on: !!app.heartConditions },
    { label: 'Epilepsy', on: !!app.epilepsy },
    { label: 'Eczema', on: !!app.eczema },
    { label: 'Diabetes', on: !!app.diabetes },
  ];
  const positiveFlags = flags.filter((f) => f.on);
  const hasDetails =
    !!app.allergyDetails ||
    !!app.foodAllergyDetails ||
    !!app.dietaryRestrictions ||
    !!app.otherMedicalConditions;
  const hasAnything =
    positiveFlags.length > 0 || hasDetails || app.paracetamolConsent !== null;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Medical · dietary
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Health profile
        </CardTitle>
        <CardAction>
          <ActionTile icon={Stethoscope} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">No medical or dietary notes on file.</p>
        ) : (
          <>
            {positiveFlags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {positiveFlags.map((f) => (
                  <Badge key={f.label} variant="blocked" className="gap-1">
                    <AlertTriangle className="size-3" />
                    {f.label}
                  </Badge>
                ))}
              </div>
            )}
            {hasDetails && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {app.allergyDetails && (
                  <DetailRow
                    label="Allergy details"
                    value={app.allergyDetails}
                    icon={AlertTriangle}
                    tone="destructive"
                  />
                )}
                {app.foodAllergyDetails && (
                  <DetailRow
                    label="Food allergy details"
                    value={app.foodAllergyDetails}
                    icon={Utensils}
                    tone="destructive"
                  />
                )}
                {app.dietaryRestrictions && (
                  <DetailRow
                    label="Dietary restrictions"
                    value={app.dietaryRestrictions}
                    icon={Utensils}
                    tone="warning"
                  />
                )}
                {app.otherMedicalConditions && (
                  <DetailRow
                    label="Other conditions"
                    value={app.otherMedicalConditions}
                    icon={Stethoscope}
                    tone="destructive"
                  />
                )}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-hairline pt-3 text-[13px]">
              <Pill className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Paracetamol consent
              </span>
              {app.paracetamolConsent === true ? (
                <Badge variant="success" className="gap-1">
                  <Check className="size-3" />
                  Granted
                </Badge>
              ) : app.paracetamolConsent === false ? (
                <Badge variant="blocked" className="gap-1">
                  <X className="size-3" />
                  Withheld
                </Badge>
              ) : (
                <Badge variant="muted">Not specified</Badge>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Tinted detail block — small leading icon tile + mono uppercase label +
// long-form value. The tile color shifts by `tone` so dietary notes (amber)
// read distinctly from medical conditions (destructive).
function DetailRow({
  label,
  value,
  icon: Icon,
  tone = 'destructive',
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'destructive' | 'warning';
}) {
  const tileClass =
    tone === 'warning'
      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
      : 'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive';
  return (
    <div className="rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tileClass}`}>
            <Icon className="size-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="text-[13px] leading-relaxed text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

// Billing tile — mirrors the ServicePreferencesCard service tile layout
// (gradient icon + label + value). One tile per Enrolee type / Payment /
// Discounts so the bottom strip reads as a row of peers, not a text list.
function BillingTile({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

